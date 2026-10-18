import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Pause, Play, Plus, RefreshCw } from 'lucide-react'
import {
  DATA_TIERS,
  addDataPurchase,
  bulkSetDataPlan,
  commitmentFor,
  deliveryLabel,
  filterUsers,
  formatBytes,
  formatDuration,
  loadDataHistory,
  loadDataOverview,
  loadDataPurchases,
  loadDataUsers,
  loadPhones,
  loadTopupOverview,
  naira,
  poolBanner,
  setDataPlan,
  setLowPoolAlert,
  setPhone,
  sizeToBytes,
  usageCsv,
  type DataOverview,
  type DataPurchase,
  type DataTierCode,
  type HistoryPoint,
  type PhoneRow,
  type SizeUnit,
  type TopupOverview,
  type UserRow,
} from '../lib/dataAllocation'
import AdminDataDelivery from './AdminDataDelivery'
import '../data-allocation.css'

function HistoryChart({ points }: { points: HistoryPoint[] }) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.used_bytes, p.allowance_bytes)))
  return (
    <div className="dataChart" role="img" aria-label="Data used per day for the last two weeks">
      {points.map((p) => {
        const d = new Date(`${p.day}T00:00:00`)
        return (
          <div key={p.day} className="dataChartDay" title={`${d.toLocaleDateString()}: ${formatBytes(p.used_bytes)} delivered of ${formatBytes(p.allowance_bytes)} allocated`}>
            <div className="dataChartBars">
              <span className="allocated" style={{ height: `${(p.allowance_bytes / max) * 100}%` }} />
              <span className="used" style={{ height: `${(p.used_bytes / max) * 100}%` }} />
            </div>
            <small>{d.getDate()}</small>
          </div>
        )
      })}
    </div>
  )
}

export default function AdminDataAllocation() {
  const [overview, setOverview] = useState<DataOverview | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [purchases, setPurchases] = useState<DataPurchase[]>([])
  const [phones, setPhones] = useState<Record<string, PhoneRow>>({})
  const [topup, setTopup] = useState<TopupOverview | null>(null)
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [query, setQuery] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTier, setBulkTier] = useState<string>('gb1')

  const [purchaseAmount, setPurchaseAmount] = useState('')
  const [purchaseUnit, setPurchaseUnit] = useState<SizeUnit>('GB')
  const [purchaseLabel, setPurchaseLabel] = useState('')
  const [purchaseCost, setPurchaseCost] = useState('')
  const [purchaseNote, setPurchaseNote] = useState('')
  const [alertPercent, setAlertPercent] = useState('15')


  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [o, u, h, p, ph, t] = await Promise.all([
        loadDataOverview(),
        loadDataUsers(),
        loadDataHistory(14),
        loadDataPurchases(),
        loadPhones(),
        loadTopupOverview(),
      ])
      setOverview(o)
      setUsers(u)
      setHistory(h)
      setPurchases(p)
      setPhones(Object.fromEntries(ph.map((row) => [row.employee_id, row])))
      setTopup(t)
      setPhoneDrafts({})
      setAlertPercent(String(o.low_pool_percent))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load data allocation.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const visible = useMemo(() => filterUsers(users, query, tierFilter), [users, query, tierFilter])
  const banner = poolBanner(overview)
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.employee_id))

  const bulkOverrides = useMemo(() => {
    const map: Record<string, DataTierCode | null> = {}
    for (const id of selected) map[id] = bulkTier === 'none' ? null : (bulkTier as DataTierCode)
    return map
  }, [selected, bulkTier])
  const commitmentAfterBulk = useMemo(() => commitmentFor(users, bulkOverrides), [users, bulkOverrides])

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.employee_id)))
  }

  function submitPurchase() {
    const bytes = sizeToBytes(purchaseAmount, purchaseUnit)
    if (bytes === null) {
      setError('Enter the amount of data you bought, for example 1500 GB.')
      return
    }
    const cost = purchaseCost.trim() === '' ? null : Number(purchaseCost.replace(/,/g, ''))
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setError('Cost must be a number.')
      return
    }
    void run(async () => {
      await addDataPurchase({
        bytes,
        label: purchaseLabel.trim(),
        costNgn: cost,
        note: purchaseNote.trim(),
        purchasedOn: null,
      })
      setPurchaseAmount('')
      setPurchaseLabel('')
      setPurchaseCost('')
      setPurchaseNote('')
    }, `Added ${formatBytes(bytes)} to the pool.`)
  }

  function downloadCsv() {
    const blob = new Blob([usageCsv(users)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `data-usage-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  function savePhone(row: UserRow) {
    const draft = phoneDrafts[row.employee_id]
    if (draft === undefined) return
    const current = phones[row.employee_id]?.msisdn ?? ''
    if (draft.trim() === current) return
    void run(() => setPhone(row.employee_id, draft.trim()), draft.trim() === '' ? 'Number removed.' : 'Number saved.')
  }

  const poolPct = overview && overview.purchased_bytes > 0
    ? Math.max(0, Math.min(100, (overview.remaining_bytes / overview.purchased_bytes) * 100))
    : 0

  return (
    <section className="dataAllocation" aria-label="Data allocation">
      <div className="dataHead glassCard">
        <div>
          <span className="eyebrow">DATA ALLOCATION</span>
          <h3>Company data pool and daily allowances</h3>
          <p>
            Set aside a pool of data, give everyone a daily plan (500 MB, 1 GB, 2 GB, 3 GB or 5 GB), and each morning
            their bundle is bought straight into their own MTN number, wherever they work.
          </p>
        </div>
        <button type="button" className="glassButton" onClick={() => void refresh()} disabled={loading || busy}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error && <div className="dataMessage danger" role="alert">{error}</div>}
      {notice && <div className="dataMessage ok" role="status">{notice}</div>}
      {banner && (
        <div className={`dataMessage ${banner.tone === 'danger' ? 'danger' : 'warn'}`} role="alert">
          <AlertTriangle size={15} /> {banner.text}
        </div>
      )}

      <div className="dataMetrics">
        <article className="glassCard dataMetric">
          <span>Pool purchased</span>
          <strong>{overview ? formatBytes(overview.purchased_bytes) : '...'}</strong>
          <small>{purchases.length} purchase{purchases.length === 1 ? '' : 's'}</small>
        </article>
        <article className="glassCard dataMetric">
          <span>Pool remaining</span>
          <strong>{overview ? formatBytes(overview.remaining_bytes) : '...'}</strong>
          <div className={`dataBar ${overview?.pool_exhausted ? 'out' : overview?.pool_low ? 'warn' : 'ok'}`}><span style={{ width: `${poolPct}%` }} /></div>
        </article>
        <article className="glassCard dataMetric">
          <span>Delivered today</span>
          <strong>{overview ? formatBytes(overview.used_today_bytes) : '...'}</strong>
          <small>{topup ? `${topup.delivered_today} of ${topup.people_ready} ready people` : ''}</small>
        </article>
        <article className="glassCard dataMetric">
          <span>Runway</span>
          <strong>{overview?.runway_days_commitment != null ? `${overview.runway_days_commitment} days` : 'n/a'}</strong>
          <small>
            at full allocation
            {overview?.runway_days_actual != null ? `, ${overview.runway_days_actual} days at the 7 day average` : ''}
          </small>
        </article>
        <article className="glassCard dataMetric">
          <span>Spent today</span>
          <strong>{topup ? naira(topup.spent_today_ngn) : '...'}</strong>
          <small>{topup && topup.cap_ngn > 0 ? `limit ${naira(topup.cap_ngn)} a day` : 'no daily limit set'}</small>
        </article>
        <article className="glassCard dataMetric">
          <span>Delivery</span>
          <strong>{topup?.enabled ? 'On' : 'Off'}</strong>
          <small>{topup ? `${topup.pending_today} waiting, ${topup.failed_today} failed today` : ''}</small>
        </article>
      </div>

      <div className="dataTwo">
        <article className="glassCard dataPanel">
          <h4>Fund the pool</h4>
          <p className="dataHint">The total data you have set aside for staff, for example 1500 GB. Every bundle delivered is taken from it, and it stops when it is empty. 1 GB here is 1024 MB, the same as MTN counts.</p>
          <div className="dataFormRow">
            <label>
              Amount
              <input inputMode="decimal" value={purchaseAmount} onChange={(e) => setPurchaseAmount(e.target.value)} placeholder="1500" />
            </label>
            <label>
              Unit
              <select value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value as SizeUnit)}>
                <option>GB</option>
                <option>TB</option>
                <option>MB</option>
              </select>
            </label>
            <button type="button" className="glassButton" onClick={() => { setPurchaseAmount('1500'); setPurchaseUnit('GB'); setPurchaseLabel('MTN 1.5 TB') }}>
              1.5 TB
            </button>
          </div>
          <div className="dataFormRow">
            <label>
              Label
              <input value={purchaseLabel} onChange={(e) => setPurchaseLabel(e.target.value)} placeholder="October staff data" />
            </label>
            <label>
              Cost (NGN)
              <input inputMode="decimal" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} placeholder="optional" />
            </label>
          </div>
          <label className="dataWide">
            Note
            <input value={purchaseNote} onChange={(e) => setPurchaseNote(e.target.value)} placeholder="Invoice or receipt reference" />
          </label>
          <button type="button" className="primaryButton" onClick={submitPurchase} disabled={busy}>
            <Plus size={14} />
            Add to pool
          </button>

          {purchases.length > 0 && (
            <ul className="dataList" aria-label="Purchases">
              {purchases.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <span><strong>{formatBytes(p.bytes)}</strong> {p.label || 'Data purchase'}</span>
                  <small>{new Date(`${p.purchased_on}T00:00:00`).toLocaleDateString()}{p.cost_ngn != null ? ` | NGN ${Number(p.cost_ngn).toLocaleString()}` : ''}</small>
                </li>
              ))}
            </ul>
          )}

          <div className="dataFormRow dataAlert">
            <label>
              Warn me when the pool falls below (%)
              <input inputMode="numeric" value={alertPercent} onChange={(e) => setAlertPercent(e.target.value)} />
            </label>
            <button
              type="button"
              className="glassButton"
              disabled={busy}
              onClick={() => void run(() => setLowPoolAlert(Number(alertPercent)), 'Alert level saved.')}
            >
              Save
            </button>
          </div>
        </article>

        <article className="glassCard dataPanel">
          <h4>Last 14 days</h4>
          <p className="dataHint">Tall pale bar: what was allocated. Solid bar: what was delivered. Days run left to right, oldest first.</p>
          <HistoryChart points={history} />
          <div className="dataLegend"><span className="swatch allocated" /> Allocated <span className="swatch used" /> Delivered</div>
          <p className="dataHint">The day changes at 00:00 Lagos time in {overview ? formatDuration(overview.resets_in_seconds) : '...'}. Each person gets one bundle per day; nothing carries over.</p>
        </article>
      </div>

      <article className="glassCard dataPanel">
        <div className="dataTableHead">
          <div>
            <h4>Daily allocation per person</h4>
            <p className="dataHint">Pick a tier for each person, or tick several and apply one tier at once.</p>
          </div>
          <div className="dataToolbar">
            <input className="dataSearch" placeholder="Search name, email or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} aria-label="Filter by plan">
              <option value="all">All plans</option>
              <option value="none">No plan</option>
              {DATA_TIERS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
            <button type="button" className="glassButton" onClick={downloadCsv} disabled={users.length === 0}>
              <Download size={14} />
              CSV
            </button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="dataBulk" role="region" aria-label="Bulk change">
            <strong>{selected.size} selected</strong>
            <select value={bulkTier} onChange={(e) => setBulkTier(e.target.value)} aria-label="Plan for selected people">
              <option value="none">Remove plan</option>
              {DATA_TIERS.map((t) => <option key={t.code} value={t.code}>{t.label} per day</option>)}
            </select>
            <button
              type="button"
              className="primaryButton"
              disabled={busy}
              onClick={() => void run(async () => {
                await bulkSetDataPlan([...selected], bulkTier === 'none' ? null : (bulkTier as DataTierCode))
                setSelected(new Set())
              }, 'Plans updated.')}
            >
              Apply
            </button>
            <small>
              Daily commitment would become {formatBytes(commitmentAfterBulk)}
              {overview && overview.remaining_bytes > 0 && commitmentAfterBulk > 0
                ? `, about ${Math.floor(overview.remaining_bytes / commitmentAfterBulk)} days of pool`
                : ''}
            </small>
          </div>
        )}

        <div className="dataTableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select everyone shown" /></th>
                <th>Person</th>
                <th>Daily plan</th>
                <th>MTN number</th>
                <th>Today</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const suspended = row.plan_status === 'suspended'
                                return (
                  <tr key={row.employee_id} className={suspended ? 'suspended' : ''}>
                    <td><input type="checkbox" checked={selected.has(row.employee_id)} onChange={() => toggle(row.employee_id)} aria-label={`Select ${row.full_name || row.email}`} /></td>
                    <td>
                      <strong>{row.full_name || row.email}</strong>
                      <small>{row.email}{row.department ? ` | ${row.department}` : ''}</small>
                    </td>
                    <td>
                      <select
                        value={row.tier_code ?? 'none'}
                        disabled={busy}
                        aria-label={`Daily plan for ${row.full_name || row.email}`}
                        onChange={(e) => void run(
                          () => setDataPlan(row.employee_id, e.target.value === 'none' ? null : (e.target.value as DataTierCode), row.plan_status ?? 'active'),
                          'Plan updated.',
                        )}
                      >
                        <option value="none">No plan</option>
                        {DATA_TIERS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                      </select>
                      {suspended && <small className="dataSuspended">Suspended</small>}
                    </td>
                    <td>
                      {row.tier_code ? (
                        <input
                          className="dataPhone"
                          inputMode="tel"
                          aria-label={`MTN number for ${row.full_name || row.email}`}
                          placeholder="0803 123 4567"
                          disabled={busy}
                          value={phoneDrafts[row.employee_id] ?? phones[row.employee_id]?.msisdn ?? ''}
                          onChange={(e) => setPhoneDrafts({ ...phoneDrafts, [row.employee_id]: e.target.value })}
                          onBlur={() => savePhone(row)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        />
                      ) : (
                        <small>No plan</small>
                      )}
                    </td>
                    <td>
                      {row.tier_code ? (
                        <>
                          <span className={`dataChip ${phones[row.employee_id]?.today_status === 'delivered' ? 'ok' : phones[row.employee_id]?.today_status === 'failed' ? 'danger' : phones[row.employee_id]?.today_status ? 'warn' : 'muted'}`}>
                            {deliveryLabel(phones[row.employee_id]?.today_status)}
                          </span>
                          {phones[row.employee_id]?.today_message && <small>{phones[row.employee_id]?.today_message}</small>}
                        </>
                      ) : (
                        <small>No allowance</small>
                      )}
                    </td>
                    <td>
                      <div className="dataActions">
                        {row.tier_code && (
                          <button
                            type="button"
                            className="glassButton"
                            disabled={busy}
                            onClick={() => void run(
                              () => setDataPlan(row.employee_id, row.tier_code, suspended ? 'active' : 'suspended'),
                              suspended ? 'Plan resumed. Deliveries continue tomorrow morning.' : 'Plan suspended. No more bundles will be bought for them.',
                            )}
                          >
                            {suspended ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Suspend</>}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="dataEmpty">{loading ? 'Loading...' : 'Nobody matches.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="dataHint">
          Daily commitment: <strong>{formatBytes(commitmentFor(users))}</strong> for {users.filter((u) => u.tier_code && u.plan_status !== 'suspended').length} people.
          Deactivating someone in the workspace stops their deliveries from the next run.
        </p>
      </article>

      <AdminDataDelivery onChanged={() => void refresh()} />
    </section>
  )
}


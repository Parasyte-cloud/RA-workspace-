import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import {
  DATA_RADIUS_URL,
  DATA_TIERS,
  adjustDataToday,
  addDataPurchase,
  bulkSetDataPlan,
  commitmentFor,
  deleteDataDevice,
  filterUsers,
  formatBytes,
  formatDuration,
  gatewayState,
  loadDataDevices,
  loadDataHistory,
  loadDataOverview,
  loadDataPurchases,
  loadDataUsers,
  poolBanner,
  recordManualUsage,
  resetNetworkPassword,
  saveDataDevice,
  setDataPlan,
  setLowPoolAlert,
  sizeToBytes,
  usageCsv,
  usageLevel,
  usagePercent,
  type DataDevice,
  type DataOverview,
  type DataPurchase,
  type DataTierCode,
  type HistoryPoint,
  type SizeUnit,
  type UserRow,
} from '../lib/dataAllocation'
import '../data-allocation.css'

type Dialog =
  | { kind: 'password'; name: string; email: string; password: string }
  | { kind: 'adjust'; user: UserRow }
  | { kind: 'usage'; user: UserRow }
  | null

function when(value: string | null | undefined) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function UsageBar({ used, allowance }: { used: number; allowance: number }) {
  const level = usageLevel(used, allowance)
  const pct = usagePercent(used, allowance)
  return (
    <div className={`dataBar ${level}`} role="img" aria-label={`${pct}% of today's allowance used`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

function HistoryChart({ points }: { points: HistoryPoint[] }) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.used_bytes, p.allowance_bytes)))
  return (
    <div className="dataChart" role="img" aria-label="Data used per day for the last two weeks">
      {points.map((p) => {
        const d = new Date(`${p.day}T00:00:00`)
        return (
          <div key={p.day} className="dataChartDay" title={`${d.toLocaleDateString()}: ${formatBytes(p.used_bytes)} used of ${formatBytes(p.allowance_bytes)} allocated`}>
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
  const [devices, setDevices] = useState<DataDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)

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

  const [deviceForm, setDeviceForm] = useState({ id: '', label: '', msisdn: '', imei: '', employee_id: '', note: '' })
  const [adjustSign, setAdjustSign] = useState<'add' | 'remove'>('add')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustUnit, setAdjustUnit] = useState<SizeUnit>('MB')
  const [adjustReason, setAdjustReason] = useState('')
  const [usageAmount, setUsageAmount] = useState('')
  const [usageUnit, setUsageUnit] = useState<SizeUnit>('MB')
  const [usageNote, setUsageNote] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [o, u, h, p, d] = await Promise.all([
        loadDataOverview(),
        loadDataUsers(),
        loadDataHistory(14),
        loadDataPurchases(),
        loadDataDevices(),
      ])
      setOverview(o)
      setUsers(u)
      setHistory(h)
      setPurchases(p)
      setDevices(d)
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

  // Escape closes whichever dialog is open.
  useEffect(() => {
    if (!dialog) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog])

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
  const gateway = gatewayState(overview?.gateway_last_seen)
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

  function submitAdjust() {
    if (dialog?.kind !== 'adjust') return
    const bytes = sizeToBytes(adjustAmount, adjustUnit)
    if (bytes === null) {
      setError('Enter how much data to change.')
      return
    }
    if (adjustReason.trim().length < 3) {
      setError('Give a short reason, it is kept in the audit trail.')
      return
    }
    const user = dialog.user
    void run(async () => {
      await adjustDataToday(user.employee_id, adjustSign === 'add' ? bytes : -bytes, adjustReason.trim())
      setDialog(null)
      setAdjustAmount('')
      setAdjustReason('')
    }, `${adjustSign === 'add' ? 'Added' : 'Removed'} ${formatBytes(bytes)} ${adjustSign === 'add' ? 'for' : 'from'} ${user.full_name || user.email} today.`)
  }

  function submitUsage() {
    if (dialog?.kind !== 'usage') return
    const bytes = sizeToBytes(usageAmount, usageUnit)
    if (bytes === null) {
      setError('Enter the amount of data used.')
      return
    }
    const user = dialog.user
    void run(async () => {
      await recordManualUsage(user.employee_id, bytes, usageNote.trim())
      setDialog(null)
      setUsageAmount('')
      setUsageNote('')
    }, `Recorded ${formatBytes(bytes)} used by ${user.full_name || user.email}.`)
  }

  async function issuePassword(user: UserRow) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const password = await resetNetworkPassword(user.employee_id)
      setDialog({ kind: 'password', name: user.full_name || user.email, email: user.email, password })
      setCopied(false)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a password.')
    } finally {
      setBusy(false)
    }
  }

  async function copyPassword(password: string) {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
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

  function submitDevice() {
    void run(async () => {
      await saveDataDevice({
        id: deviceForm.id || null,
        label: deviceForm.label,
        msisdn: deviceForm.msisdn,
        imei: deviceForm.imei,
        employee_id: deviceForm.employee_id || null,
        note: deviceForm.note,
        active: true,
      })
      setDeviceForm({ id: '', label: '', msisdn: '', imei: '', employee_id: '', note: '' })
    }, 'MiFi saved.')
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
            Buy data in bulk, give everyone a daily allowance (500 MB, 1 GB, 2 GB, 3 GB or 5 GB) and see what is
            actually used. The office RADIUS server enforces it; this screen controls it.
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
          <span>Used today</span>
          <strong>{overview ? formatBytes(overview.used_today_bytes) : '...'}</strong>
          <small>of {overview ? formatBytes(overview.daily_commitment_bytes) : '...'} allocated</small>
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
          <span>Out of data today</span>
          <strong>{overview?.users_out_today ?? '...'}</strong>
          <small>{overview ? `${overview.users_unplanned} people have no plan` : ''}</small>
        </article>
        <article className="glassCard dataMetric">
          <span>Gateway</span>
          <strong className={`dataGateway ${gateway}`}>
            {gateway === 'live' ? <Wifi size={16} /> : <WifiOff size={16} />}
            {gateway === 'live' ? 'Connected' : gateway === 'quiet' ? 'Quiet' : 'Not connected'}
          </strong>
          <small>
            {gateway === 'never'
              ? 'No usage reported yet. See the setup steps below.'
              : `${overview?.gateway_active_sessions ?? 0} live sessions, last report ${when(overview?.gateway_last_seen)}`}
          </small>
        </article>
      </div>

      <div className="dataTwo">
        <article className="glassCard dataPanel">
          <h4>Record a data purchase</h4>
          <p className="dataHint">Enter exactly what the SIM or MTN portal shows. 1 GB here is 1024 MB, the same as MTN counts.</p>
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
              <input value={purchaseLabel} onChange={(e) => setPurchaseLabel(e.target.value)} placeholder="MTN business bundle" />
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
          <p className="dataHint">Tall pale bar: what was allocated. Solid bar: what was used. Days run left to right, oldest first.</p>
          <HistoryChart points={history} />
          <div className="dataLegend"><span className="swatch allocated" /> Allocated <span className="swatch used" /> Used</div>
          <p className="dataHint">Allowances reset at 00:00 Lagos time in {overview ? formatDuration(overview.resets_in_seconds) : '...'}. Unused data does not roll over and is not taken from the pool.</p>
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
                <th>Today</th>
                <th>Last online</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const suspended = row.plan_status === 'suspended'
                const remaining = Math.max(0, row.allowance_bytes - row.used_bytes)
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
                        <>
                          <UsageBar used={row.used_bytes} allowance={row.allowance_bytes} />
                          <small>{formatBytes(row.used_bytes)} of {formatBytes(row.allowance_bytes)} ({formatBytes(remaining)} left)</small>
                        </>
                      ) : (
                        <small>No allowance</small>
                      )}
                    </td>
                    <td><small>{when(row.last_seen)}</small></td>
                    <td>
                      <div className="dataActions">
                        <button type="button" className="glassButton" disabled={busy || !row.tier_code} onClick={() => { setAdjustSign('add'); setDialog({ kind: 'adjust', user: row }) }}>
                          <Plus size={13} /> Data
                        </button>
                        <button type="button" className="glassButton" disabled={busy || !row.tier_code} onClick={() => setDialog({ kind: 'usage', user: row })} title="Record usage the gateway cannot see, for example a MiFi on its own SIM">
                          Usage
                        </button>
                        <button type="button" className="glassButton" disabled={busy || !row.tier_code} onClick={() => void issuePassword(row)}>
                          <KeyRound size={13} /> {row.has_credential ? 'New password' : 'Password'}
                        </button>
                        {row.tier_code && (
                          <button
                            type="button"
                            className="glassButton"
                            disabled={busy}
                            onClick={() => void run(
                              () => setDataPlan(row.employee_id, row.tier_code, suspended ? 'active' : 'suspended'),
                              suspended ? 'Plan resumed.' : 'Plan suspended. Open sessions are cut within a minute.',
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
          Removing someone from the workspace (or deactivating them) cuts their data within a minute.
        </p>
      </article>

      <div className="dataTwo">
        <article className="glassCard dataPanel">
          <h4><Smartphone size={15} /> MiFi devices</h4>
          <p className="dataHint">A register of the MTN MiFi units and SIMs, so you know which number belongs to whom.</p>
          <div className="dataFormRow">
            <label>
              Label
              <input value={deviceForm.label} onChange={(e) => setDeviceForm({ ...deviceForm, label: e.target.value })} placeholder="MiFi 07" />
            </label>
            <label>
              SIM number
              <input value={deviceForm.msisdn} onChange={(e) => setDeviceForm({ ...deviceForm, msisdn: e.target.value })} placeholder="+234 803 000 0000" />
            </label>
          </div>
          <div className="dataFormRow">
            <label>
              IMEI
              <input inputMode="numeric" value={deviceForm.imei} onChange={(e) => setDeviceForm({ ...deviceForm, imei: e.target.value })} placeholder="15 digits" />
            </label>
            <label>
              Held by
              <select value={deviceForm.employee_id} onChange={(e) => setDeviceForm({ ...deviceForm, employee_id: e.target.value })}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.employee_id} value={u.employee_id}>{u.full_name || u.email}</option>)}
              </select>
            </label>
          </div>
          <label className="dataWide">
            Note
            <input value={deviceForm.note} onChange={(e) => setDeviceForm({ ...deviceForm, note: e.target.value })} />
          </label>
          <div className="dataFormRow">
            <button type="button" className="primaryButton" onClick={submitDevice} disabled={busy || !deviceForm.label.trim()}>
              {deviceForm.id ? 'Save changes' : 'Add MiFi'}
            </button>
            {deviceForm.id && (
              <button type="button" className="glassButton" onClick={() => setDeviceForm({ id: '', label: '', msisdn: '', imei: '', employee_id: '', note: '' })}>Cancel</button>
            )}
          </div>
          <ul className="dataList" aria-label="MiFi devices">
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{d.label}</strong> {d.msisdn}
                  <small>{users.find((u) => u.employee_id === d.employee_id)?.full_name || 'Unassigned'}{d.imei ? ` | IMEI ${d.imei}` : ''}</small>
                </span>
                <span className="dataActions">
                  <button type="button" className="glassButton" onClick={() => setDeviceForm({ id: d.id, label: d.label, msisdn: d.msisdn, imei: d.imei, employee_id: d.employee_id ?? '', note: d.note })}>Edit</button>
                  <button type="button" className="glassButton" aria-label={`Delete ${d.label}`} disabled={busy} onClick={() => { if (window.confirm(`Remove ${d.label} from the register?`)) void run(() => deleteDataDevice(d.id), 'MiFi removed.') }}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
            {devices.length === 0 && <li className="dataEmpty">No devices registered yet.</li>}
          </ul>
        </article>

        <article className="glassCard dataPanel">
          <h4><Wifi size={15} /> Connect the office gateway</h4>
          <p className="dataHint">
            A MiFi cannot enforce per-person limits on its own. People connect their laptops and phones to the office
            Wi-Fi; the gateway signs them in against this workspace through FreeRADIUS and reports their usage.
          </p>
          <ol className="dataSteps">
            <li>Set the shared secret: <code>supabase secrets set DATA_RADIUS_SECRET=...</code> and deploy <code>data-radius</code>.</li>
            <li>Install FreeRADIUS with <code>ops/freeradius/install.sh</code> and point it at this endpoint:</li>
          </ol>
          <code className="dataUrl">{DATA_RADIUS_URL}</code>
          <ol className="dataSteps" start={3}>
            <li>On the gateway, add the RADIUS server and turn on accounting and Disconnect (CoA).</li>
            <li>Create each person's network password with the Password button. They sign in with their work email.</li>
          </ol>
          <p className="dataHint">The full guide, with MikroTik commands, is in <code>docs/data-allocation.md</code>. When the first usage report arrives the Gateway tile above turns green.</p>
        </article>
      </div>

      {dialog?.kind === 'password' && (
        <div className="dataModalBackdrop" role="dialog" aria-modal="true" aria-label="Network password">
          <div className="dataModal glassCard">
            <h4>Network password for {dialog.name}</h4>
            <p>Shown once. Give it to them privately. They sign in to the office Wi-Fi with:</p>
            <dl>
              <dt>Username</dt><dd>{dialog.email}</dd>
              <dt>Password</dt><dd className="dataPassword">{dialog.password}</dd>
            </dl>
            <div className="dataFormRow">
              <button type="button" className="primaryButton" onClick={() => void copyPassword(dialog.password)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy password'}
              </button>
              <button type="button" className="glassButton" onClick={() => setDialog(null)}>Done</button>
            </div>
            <small>Any earlier password for this person no longer works.</small>
          </div>
        </div>
      )}

      {dialog?.kind === 'adjust' && (
        <div className="dataModalBackdrop" role="dialog" aria-modal="true" aria-label="Change today's data">
          <div className="dataModal glassCard">
            <h4>Change today's data for {dialog.user.full_name || dialog.user.email}</h4>
            <p>Applies to today only. Tomorrow they are back on their {DATA_TIERS.find((t) => t.code === dialog.user.tier_code)?.label} plan.</p>
            <div className="dataFormRow">
              <label>
                Change
                <select value={adjustSign} onChange={(e) => setAdjustSign(e.target.value as 'add' | 'remove')}>
                  <option value="add">Add</option>
                  <option value="remove">Remove</option>
                </select>
              </label>
              <label>
                Amount
                <input inputMode="decimal" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="500" autoFocus />
              </label>
              <label>
                Unit
                <select value={adjustUnit} onChange={(e) => setAdjustUnit(e.target.value as SizeUnit)}>
                  <option>MB</option>
                  <option>GB</option>
                </select>
              </label>
            </div>
            <label className="dataWide">
              Reason
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Client call all afternoon" />
            </label>
            <div className="dataFormRow">
              <button type="button" className="primaryButton" onClick={submitAdjust} disabled={busy}>Apply</button>
              <button type="button" className="glassButton" onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === 'usage' && (
        <div className="dataModalBackdrop" role="dialog" aria-modal="true" aria-label="Record usage">
          <div className="dataModal glassCard">
            <h4>Record usage for {dialog.user.full_name || dialog.user.email}</h4>
            <p>For data the gateway cannot see, such as a MiFi on its own SIM. It counts against today's allowance and the pool.</p>
            <div className="dataFormRow">
              <label>
                Amount used
                <input inputMode="decimal" value={usageAmount} onChange={(e) => setUsageAmount(e.target.value)} placeholder="250" autoFocus />
              </label>
              <label>
                Unit
                <select value={usageUnit} onChange={(e) => setUsageUnit(e.target.value as SizeUnit)}>
                  <option>MB</option>
                  <option>GB</option>
                </select>
              </label>
            </div>
            <label className="dataWide">
              Note
              <input value={usageNote} onChange={(e) => setUsageNote(e.target.value)} placeholder="Reading from the MTN portal" />
            </label>
            <div className="dataFormRow">
              <button type="button" className="primaryButton" onClick={submitUsage} disabled={busy}>Record</button>
              <button type="button" className="glassButton" onClick={() => setDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}


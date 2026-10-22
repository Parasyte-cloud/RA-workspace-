import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Play, RefreshCw, Send } from 'lucide-react'
import {
  deliveryLabel,
  formatBytes,
  formatDuration,
  importPhones,
  loadProviderBundles,
  loadProviderStatus,
  loadTopupOverview,
  loadTopups,
  naira,
  parsePhoneLines,
  resolveTopup,
  runTopupNow,
  saveTierBundle,
  setTopupSettings,
  topupBlockers,
  type ProviderBundle,
  type TopupOverview,
  type TopupRow,
} from '../lib/dataAllocation'
import { csvEscape } from '../lib/dataAllocationModel'
import '../data-allocation.css'

function stamp(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Delivery control: the MTN bundle behind each plan, the daily spending limit, the master switch,
// the run button, and today's deliveries. Nothing is bought until it is switched on here.
export default function AdminDataDelivery({ onChanged }: { onChanged: () => void }) {
  const [overview, setOverview] = useState<TopupOverview | null>(null)
  const [rows, setRows] = useState<TopupRow[]>([])
  const [provider, setProvider] = useState<{ configured: boolean; env: 'sandbox' | 'live' | null; can_list_bundles: boolean } | null>(null)
  const [providerError, setProviderError] = useState('')
  const [bundles, setBundles] = useState<ProviderBundle[]>([])
  const [drafts, setDrafts] = useState<Record<string, { code: string; price: string }>>({})
  const [cap, setCap] = useState('')
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([loadTopupOverview(), loadTopups(3)])
      setOverview(o)
      setRows(r)
      setCap(o.cap_ngn > 0 ? String(o.cap_ngn) : '')
      setDrafts(Object.fromEntries(o.tiers.map((t) => [t.code, { code: t.provider_variation, price: t.price_ngn != null ? String(t.price_ngn) : '' }])))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load delivery.')
    }
    try {
      setProvider(await loadProviderStatus())
      setProviderError('')
    } catch (caught) {
      setProvider(null)
      setProviderError(caught instanceof Error ? caught.message : 'The delivery service did not answer.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(action: () => Promise<string | void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const message = await action()
      if (message) setNotice(message)
      await load()
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const blockers = useMemo(() => topupBlockers(overview, cap), [overview, cap])
  const live = provider?.env === 'live'
  const attention = rows.filter((r) => r.status === 'pending' || r.status === 'failed')

  function saveBundle(code: string) {
    const draft = drafts[code]
    if (!draft) return
    const price = draft.price.trim() === '' ? null : Number(draft.price.replace(/,/g, ''))
    if (draft.code.trim() !== '' && (price === null || !Number.isFinite(price) || price <= 0)) {
      setError('Enter the bundle price in naira.')
      return
    }
    void act(async () => {
      await saveTierBundle(code as never, draft.code.trim(), draft.code.trim() === '' ? null : price)
      return 'Bundle saved.'
    })
  }

  function downloadRows() {
    const header = 'Day,Person,Number,Plan,Status,Amount,Note\n'
    const body = rows
      .map((r) => [r.day, r.full_name, r.msisdn_masked ?? '', r.tier_code, r.status, r.amount_ngn ?? '', r.message]
        .map((v) => csvEscape(v)).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([header + body], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `data-deliveries-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <article className="glassCard dataPanel dataDelivery" aria-label="Daily delivery">
      <div className="dataTableHead">
        <div>
          <h4><Send size={15} /> Daily delivery to each person's MTN number</h4>
          <p className="dataHint">
            Every morning at about 05:00 Lagos time, each person's plan is bought straight into their own MTN line through VTpass,
            so it works wherever they are. Nothing is bought until you switch this on.
          </p>
        </div>
        <button type="button" className="glassButton" onClick={() => void act(async () => undefined)} disabled={busy}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="dataMessage danger" role="alert">{error}</div>}
      {notice && <div className="dataMessage ok" role="status">{notice}</div>}

      <div className="dataStatusRow">
        <span className={`dataChip ${provider?.configured ? 'ok' : 'danger'}`}>
          {provider === null ? 'Delivery service not reachable' : provider.configured ? 'VTpass keys set' : 'VTpass keys missing'}
        </span>
        {provider?.env && (
          <span className={`dataChip ${live ? 'warn' : 'muted'}`}>
            {live ? 'LIVE: real money is spent' : 'SANDBOX: test mode, no real data is sent'}
          </span>
        )}
        <span className={`dataChip ${overview?.enabled ? 'ok' : 'muted'}`}>{overview?.enabled ? 'Delivery is ON' : 'Delivery is OFF'}</span>
        {overview && <span className="dataHint">Next daily reset in {formatDuration(overview.resets_in_seconds)}</span>}
      </div>
      {providerError && <p className="dataHint">{providerError} See the set-up steps in docs/data-allocation.md.</p>}
      {provider && !provider.configured && (
        <p className="dataHint">Set the keys with <code>supabase secrets set VTPASS_API_KEY=... VTPASS_SECRET_KEY=... VTPASS_PUBLIC_KEY=...</code> and deploy <code>data-topup</code>.</p>
      )}

      <h5>1. Choose the MTN bundle behind each plan</h5>
      <p className="dataHint">
        Pick the daily bundle that matches each size, and check its price on VTpass. Plans without a bundle are skipped.
        {provider?.can_list_bundles ? '' : ' Add VTPASS_PUBLIC_KEY to load the list from VTpass; until then type the bundle code.'}
      </p>
      <div className="dataFormRow">
        <button
          type="button"
          className="glassButton"
          disabled={busy || !provider?.can_list_bundles}
          onClick={() => void act(async () => {
            const list = await loadProviderBundles()
            setBundles(list)
            return `Loaded ${list.length} MTN bundles from VTpass.`
          })}
        >
          <Download size={14} /> Load bundles from VTpass
        </button>
      </div>
      <div className="dataTableWrap">
        <table className="dataTable">
          <thead><tr><th>Plan</th><th>Bundle</th><th>Price (NGN)</th><th /></tr></thead>
          <tbody>
            {(overview?.tiers ?? []).map((tier) => {
              const draft = drafts[tier.code] ?? { code: '', price: '' }
              return (
                <tr key={tier.code}>
                  <td><strong>{tier.label}</strong><small>{formatBytes(tier.daily_bytes)} a day</small></td>
                  <td>
                    {bundles.length > 0 && (
                      <select
                        aria-label={`VTpass bundle for ${tier.label}`}
                        value={bundles.some((b) => b.code === draft.code) ? draft.code : ''}
                        onChange={(e) => {
                          const picked = bundles.find((b) => b.code === e.target.value)
                          setDrafts({ ...drafts, [tier.code]: { code: picked?.code ?? '', price: picked ? String(picked.price) : '' } })
                        }}
                      >
                        <option value="">Pick a bundle</option>
                        {bundles.map((b) => <option key={b.code} value={b.code}>{b.name || b.code} ({naira(b.price)})</option>)}
                      </select>
                    )}
                    <input
                      aria-label={`Bundle code for ${tier.label}`}
                      value={draft.code}
                      onChange={(e) => setDrafts({ ...drafts, [tier.code]: { ...draft, code: e.target.value } })}
                      placeholder="bundle code"
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Price for ${tier.label}`}
                      inputMode="decimal"
                      value={draft.price}
                      onChange={(e) => setDrafts({ ...drafts, [tier.code]: { ...draft, price: e.target.value } })}
                      placeholder="350"
                    />
                  </td>
                  <td><button type="button" className="glassButton" disabled={busy} onClick={() => saveBundle(tier.code)}>Save</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h5>2. Set a daily spending limit and switch it on</h5>
      <div className="dataFormRow">
        <label>
          Spend at most (NGN per day)
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="e.g. 20000" />
        </label>
        {overview?.enabled ? (
          <>
            <button type="button" className="glassButton" disabled={busy} onClick={() => void act(async () => { await setTopupSettings(true, Number(cap.replace(/,/g, '')) || 0); return 'Limit saved.' })}>Save limit</button>
            <button type="button" className="glassButton" disabled={busy} onClick={() => void act(async () => { await setTopupSettings(false, Number(cap.replace(/,/g, '')) || 0); return 'Delivery switched off. Nothing more will be bought.' })}>
              Switch off
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primaryButton"
            disabled={busy || blockers.length > 0}
            onClick={() => {
              if (live && !window.confirm('Delivery is LIVE. Real money will be spent from your VTpass wallet every morning. Switch it on?')) return
              void act(async () => { await setTopupSettings(true, Number(cap.replace(/,/g, ''))); return 'Delivery is on.' })
            }}
          >
            <Play size={14} /> Switch delivery on
          </button>
        )}
      </div>
      {!overview?.enabled && blockers.length > 0 && <p className="dataHint">Before you can switch on: {blockers.join('; ')}.</p>}
      {overview && (
        <p className="dataHint">
          {overview.people_ready} of {overview.people_planned} people with an active plan are ready (a plan, an MTN number and a bundle).
          {overview.people_missing_phone > 0 ? ` ${overview.people_missing_phone} still need an MTN number.` : ''}
          {' '}Today so far: {naira(overview.spent_today_ngn)} spent{overview.cap_ngn > 0 ? ` of ${naira(overview.cap_ngn)}` : ''}.
        </p>
      )}

      <h5>3. Run it</h5>
      <div className="dataFormRow">
        <button
          type="button"
          className="primaryButton"
          disabled={busy || !overview?.enabled || !provider?.configured}
          onClick={() => void act(async () => {
            const s = await runTopupNow()
            const bits = [`${s.delivered} delivered`, `${s.pending} waiting`, `${s.failed} failed`]
            if (s.skipped) bits.push(`${s.skipped} not sent`)
            return `${s.env === 'sandbox' ? 'Test run: ' : ''}${bits.join(', ')}${s.stopped ? `. Stopped: ${s.stopped}` : ''}.`
          })}
        >
          <Send size={14} /> Run now
        </button>
        <small>Safe to press again: nobody is ever bought a second bundle on the same day, and a delivery that is still waiting is checked, not repeated.</small>
      </div>

      {attention.length > 0 && (
        <div className="dataMessage warn" role="alert">
          <AlertTriangle size={15} /> {attention.length} delivery{attention.length === 1 ? ' needs' : 's need'} a look. A waiting delivery is checked again on every run. If MTN or VTpass shows it was delivered or was not, tell me below.
        </div>
      )}

      <h5>Recent deliveries</h5>
      <div className="dataTableHead">
        <small className="dataHint">Last three days.</small>
        <button type="button" className="glassButton" onClick={downloadRows} disabled={rows.length === 0}><Download size={14} /> CSV</button>
      </div>
      <div className="dataTableWrap">
        <table className="dataTable">
          <thead><tr><th>Day</th><th>Person</th><th>Number</th><th>Plan</th><th>Status</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><small>{new Date(`${r.day}T00:00:00`).toLocaleDateString()}</small></td>
                <td><strong>{r.full_name}</strong><small>{stamp(r.updated_at)}</small></td>
                <td><small>{r.msisdn_masked}</small></td>
                <td><small>{r.tier_code}</small></td>
                <td>
                  <span className={`dataChip ${r.status === 'delivered' ? 'ok' : r.status === 'failed' ? 'danger' : 'warn'}`}>
                    {r.status === 'delivered' && <CheckCircle2 size={12} />} {deliveryLabel(r.status)}
                  </span>
                  {r.message && <small>{r.message}</small>}
                </td>
                <td><small>{r.amount_ngn != null ? naira(Number(r.amount_ngn)) : ''}</small></td>
                <td>
                  {r.status === 'pending' && (
                    <div className="dataActions">
                      <button type="button" className="glassButton" disabled={busy} onClick={() => void act(async () => { await resolveTopup(r.id, true); return 'Marked delivered.' })}>It arrived</button>
                      <button
                        type="button"
                        className="glassButton"
                        disabled={busy}
                        onClick={() => { if (window.confirm('Only choose this if VTpass shows the order did NOT go through. The next run will buy it again.')) void act(async () => { await resolveTopup(r.id, false); return 'Marked not delivered. The next run will try again.' }) }}
                      >
                        It did not
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="dataEmpty">No deliveries yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h5>MTN numbers</h5>
      <p className="dataHint">Set a number on each person's row in the table above, or paste many at once, one per line: <code>email, number</code>.</p>
      <label className="dataWide">
        Paste numbers
        <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'ada@ridearrivo.com, 0803 123 4567\nbola@ridearrivo.com, 0806 555 0101'} />
      </label>
      <div className="dataFormRow">
        <button
          type="button"
          className="glassButton"
          disabled={busy || parsePhoneLines(pasted).length === 0}
          onClick={() => void act(async () => {
            const result = await importPhones(parsePhoneLines(pasted))
            setPasted('')
            if (result.errors.length > 0) {
              setError(`${result.errors.length} line(s) were skipped: ${result.errors.slice(0, 5).map((e) => `${e.email} (${e.error})`).join('; ')}`)
            }
            return `Saved ${result.updated} number${result.updated === 1 ? '' : 's'}.`
          })}
        >
          Save numbers
        </button>
        <small>{parsePhoneLines(pasted).length} line(s) ready. People need a daily plan first.</small>
      </div>
    </article>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { control, type TelephonySettings } from '../lib/supportCommandCentre'
import '../support-command-centre.css'

// Administration, Support Routing: opening hours, voicemail, the number
// registry, the do-not-contact list and the safety limits. Everything here is
// supervisor-only and every change is written to the audit log by the server.

export type TelephonySection = 'hours' | 'numbers' | 'dnc' | 'safety'

type Hours = { weekday: number; opens_at: string; closes_at: string }
type Closure = { closes_on: string; name: string }
type NumberRow = { e164: string; label: string; dial_prefix: string | null; kind: 'inbound' | 'outbound' | 'both'; route: 'pstn' | 'byoc'; is_default_outbound: boolean; active: boolean; note: string | null }
type Dnc = { phone: string; reason: string | null; source: string; created_at: string }
type Listing = { hours: Hours[]; closures: Closure[]; numbers: NumberRow[]; dnc: Dnc[]; line: { open: boolean; reason: string; closure?: string; next_open?: string } | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hhmm = (t: string) => t.slice(0, 5)
const nextWeekdays = [1, 2, 3, 4, 5, 6, 0]

type DayState = { on: boolean; opens: string; closes: string }

export default function SupportTelephonyAdmin({ section, settings, onSettingsChanged }: {
  section: TelephonySection
  settings: TelephonySettings | null
  onSettingsChanged: () => void
}) {
  const [data, setData] = useState<Listing>({ hours: [], closures: [], numbers: [], dnc: [], line: null })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [days, setDays] = useState<Record<number, DayState>>({})
  const [ts, setTs] = useState<TelephonySettings | null>(settings)
  const [closure, setClosure] = useState({ date: '', name: '' })
  const [num, setNum] = useState({ e164: '', label: '', dialPrefix: '', kind: 'both', route: 'pstn', isDefaultOutbound: false })
  const [dncPhone, setDncPhone] = useState('')
  const [dncReason, setDncReason] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await control<Listing>({ action: 'telephony_list' })
      setData(r)
      const next: Record<number, DayState> = {}
      for (const d of [0, 1, 2, 3, 4, 5, 6]) next[d] = { on: false, opens: '08:00', closes: '18:00' }
      for (const h of r.hours) next[h.weekday] = { on: true, opens: hhmm(h.opens_at), closes: hhmm(h.closes_at) }
      setDays(next)
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load telephony settings.') }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setTs(settings) }, [settings])

  const run = async (work: () => Promise<string>) => {
    setBusy(true); setNotice('')
    try { setNotice(await work()); await load(); onSettingsChanged() }
    catch (e) { setNotice(e instanceof Error ? e.message : 'That did not save.') }
    finally { setBusy(false) }
  }

  const patch = (p: Partial<TelephonySettings>) => setTs((cur) => (cur ? { ...cur, ...p } : cur))
  const numberOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

  const saveSettings = (keys: Record<string, unknown>, done: string) => run(async () => {
    await control({ action: 'update_voice_settings', settings: keys })
    return done
  })

  return <div className="supportAdminEditor sccPanel">
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}

    {section === 'hours' && ts ? <>
      <p className="sccMuted">
        {data.line ? (data.line.open ? 'The line is open right now.' : `The line is closed right now${data.line.closure ? ` (${data.line.closure})` : ''}${data.line.next_open ? `, next opening ${new Date(data.line.next_open).toLocaleString()}` : ''}.`) : ''}
        {' '}While opening hours are not enforced the phone line answers at all times. With no hours set it also stays open, so a half-finished setup never silences the line.
      </p>
      <div className="supportAdminForm">
        <label><span>Enforce opening hours</span><input type="checkbox" checked={ts.hours_enforced} onChange={(e) => patch({ hours_enforced: e.target.checked })} /></label>
        <label><span>Time zone</span><input value={ts.timezone} onChange={(e) => patch({ timezone: e.target.value })} placeholder="Africa/Lagos" /></label>
        <label><span>Take voicemail when closed</span><input type="checkbox" checked={ts.voicemail_enabled} onChange={(e) => patch({ voicemail_enabled: e.target.checked })} /></label>
        <label><span>Longest voicemail (seconds)</span><input type="number" min={10} max={600} value={ts.voicemail_max_seconds} onChange={(e) => patch({ voicemail_max_seconds: Number(e.target.value) })} /></label>
        <label className="wide"><span>Closed message</span><input maxLength={400} value={ts.closed_message_text} onChange={(e) => patch({ closed_message_text: e.target.value })} /></label>
        <label className="wide"><span>Voicemail prompt</span><input maxLength={400} value={ts.voicemail_prompt_text} onChange={(e) => patch({ voicemail_prompt_text: e.target.value })} /></label>
      </div>
      <button type="button" className="sccVoicePrimary" disabled={busy} onClick={() => void saveSettings({
        hoursEnforced: ts.hours_enforced, timezone: ts.timezone, voicemailEnabled: ts.voicemail_enabled, voicemailMaxSeconds: ts.voicemail_max_seconds,
        closedMessageText: ts.closed_message_text, voicemailPromptText: ts.voicemail_prompt_text,
      }, 'Hours settings saved. They apply to the next call.')}><Save size={15} />Save hours settings</button>

      <h4>Weekly hours</h4>
      {nextWeekdays.map((d) => {
        const row = days[d] || { on: false, opens: '08:00', closes: '18:00' }
        const set = (p: Partial<DayState>) => setDays((cur) => ({ ...cur, [d]: { ...row, ...p } }))
        return <article className="sccAgent" key={d}>
          <input type="checkbox" checked={row.on} onChange={(e) => set({ on: e.target.checked })} aria-label={`Open on ${DAYS[d]}`} />
          <span><b>{DAYS[d]}</b><small>{row.on ? 'Open' : 'Closed all day'}</small></span>
          <span className="sccInline"><input type="time" value={row.opens} disabled={!row.on} onChange={(e) => set({ opens: e.target.value })} /> to <input type="time" value={row.closes} disabled={!row.on} onChange={(e) => set({ closes: e.target.value })} /></span>
        </article>
      })}
      <button type="button" className="sccVoicePrimary" disabled={busy} onClick={() => void run(async () => {
        const hours = Object.entries(days).filter(([, v]) => v.on).map(([d, v]) => ({ weekday: Number(d), opensAt: v.opens, closesAt: v.closes }))
        await control({ action: 'set_business_hours', hours })
        return 'Weekly hours saved.'
      })}><Save size={15} />Save weekly hours</button>

      <h4>Closures (public holidays, events)</h4>
      {data.closures.map((c) => <article className="sccAgent" key={c.closes_on}>
        <span /><span><b>{c.closes_on}</b><small>{c.name}</small></span>
        <button type="button" className="sccIconBtn" aria-label={`Remove ${c.name}`} disabled={busy} onClick={() => void run(async () => { await control({ action: 'delete_closure', date: c.closes_on }); return 'Closure removed.' })}><Trash2 size={14} /></button>
      </article>)}
      <div className="supportAdminForm">
        <label><span>Date</span><input type="date" value={closure.date} onChange={(e) => setClosure({ ...closure, date: e.target.value })} /></label>
        <label><span>Name</span><input value={closure.name} onChange={(e) => setClosure({ ...closure, name: e.target.value })} placeholder="Independence Day" /></label>
      </div>
      <button type="button" className="sccVoicePrimary" disabled={busy || !closure.date || !closure.name} onClick={() => void run(async () => { await control({ action: 'upsert_closure', date: closure.date, name: closure.name }); setClosure({ date: '', name: '' }); return 'Closure saved.' })}><Save size={15} />Add closure</button>
    </> : null}

    {section === 'numbers' ? <>
      <p className="sccMuted">
        Every number you own or rent. For an outbound call the system picks a number in the destination country first (people answer local numbers more), then the default outbound number, then the single caller ID in Voice and IVR.
        Route says how calls from that number leave: pstn through Twilio, or byoc through your own carrier trunk.
      </p>
      {data.numbers.map((n) => <article className="sccAgent" key={n.e164}>
        <div className={`sccPresence ${n.active ? 'available' : 'offline'}`} />
        <span><b>{n.e164} · {n.label}</b><small>{n.kind} · {n.route}{n.dial_prefix ? ` · for ${n.dial_prefix}` : ''}{n.is_default_outbound ? ' · default outbound' : ''}{n.active ? '' : ' · inactive'}</small></span>
        <button type="button" className="sccIconBtn" aria-label={`Delete ${n.e164}`} disabled={busy} onClick={() => void run(async () => { await control({ action: 'delete_number', e164: n.e164 }); return 'Number removed.' })}><Trash2 size={14} /></button>
      </article>)}
      {!data.numbers.length ? <div className="sccEmpty">No numbers registered. Until you add one, calls use the caller ID in Voice and IVR.</div> : null}
      <div className="supportAdminForm">
        <label><span>Number (E.164)</span><input value={num.e164} onChange={(e) => setNum({ ...num, e164: e.target.value })} placeholder="+2342012345678" /></label>
        <label><span>Label</span><input value={num.label} onChange={(e) => setNum({ ...num, label: e.target.value })} placeholder="Lagos support line" /></label>
        <label><span>Use for destinations starting</span><input value={num.dialPrefix} onChange={(e) => setNum({ ...num, dialPrefix: e.target.value })} placeholder="+234 (optional)" /></label>
        <label><span>Direction</span><select value={num.kind} onChange={(e) => setNum({ ...num, kind: e.target.value })}><option value="both">Inbound and outbound</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option></select></label>
        <label><span>Route</span><select value={num.route} onChange={(e) => setNum({ ...num, route: e.target.value })}><option value="pstn">Twilio (pstn)</option><option value="byoc">Own carrier (byoc)</option></select></label>
        <label><span>Default outbound number</span><input type="checkbox" checked={num.isDefaultOutbound} onChange={(e) => setNum({ ...num, isDefaultOutbound: e.target.checked })} /></label>
      </div>
      <button type="button" className="sccVoicePrimary" disabled={busy || !num.e164 || !num.label} onClick={() => void run(async () => {
        await control({ action: 'upsert_number', ...num })
        setNum({ e164: '', label: '', dialPrefix: '', kind: 'both', route: 'pstn', isDefaultOutbound: false })
        return 'Number saved.'
      })}><Save size={15} />Save number</button>
    </> : null}

    {section === 'dnc' ? <>
      <p className="sccMuted">Numbers on this list can never be dialled, by hand or by a scheduled callback. Officers add a number from the ticket (Do not contact). Only supervisors can remove one. Keep the reason, it is your evidence if a customer complains.</p>
      {data.dnc.map((d) => <article className="sccAgent" key={d.phone}>
        <span /><span><b>{d.phone}</b><small>{d.source.replace(/_/g, ' ')}{d.reason ? ` · ${d.reason}` : ''} · {new Date(d.created_at).toLocaleDateString()}</small></span>
        <button type="button" className="sccIconBtn" aria-label={`Remove ${d.phone}`} disabled={busy} onClick={() => void run(async () => { await control({ action: 'dnc_remove', phoneNumber: d.phone }); return 'Removed from the list.' })}><Trash2 size={14} /></button>
      </article>)}
      {!data.dnc.length ? <div className="sccEmpty">Nobody on the list.</div> : null}
      <div className="supportAdminForm">
        <label><span>Phone number</span><input value={dncPhone} onChange={(e) => setDncPhone(e.target.value)} placeholder="+2348012345678" /></label>
        <label><span>Reason</span><input value={dncReason} onChange={(e) => setDncReason(e.target.value)} /></label>
      </div>
      <button type="button" className="sccVoicePrimary" disabled={busy || !dncPhone} onClick={() => void run(async () => { await control({ action: 'dnc_add', phoneNumber: dncPhone, reason: dncReason, source: 'customer_request' }); setDncPhone(''); setDncReason(''); return 'Added.' })}><Save size={15} />Add number</button>
    </> : null}

    {section === 'safety' && ts ? <>
      <p className="sccMuted">Limits that stop a mistake or a stolen login from becoming a large bill, and the retention period for recordings. Leave a spend field empty for no limit. Retention applies to recordings and voicemails and runs every minute from the maintenance job.</p>
      <div className="supportAdminForm">
        <label><span>Enforce the do not contact list</span><input type="checkbox" checked={ts.dnc_enforced} onChange={(e) => patch({ dnc_enforced: e.target.checked })} /></label>
        <label><span>Retry over Twilio if the own-carrier trunk fails</span><input type="checkbox" checked={ts.byoc_fallback_to_pstn} onChange={(e) => patch({ byoc_fallback_to_pstn: e.target.checked })} /></label>
        <label><span>Daily spend alert (account currency)</span><input type="number" min={0} value={ts.spend_alert_daily ?? ''} onChange={(e) => patch({ spend_alert_daily: numberOrNull(e.target.value) })} /></label>
        <label><span>Daily spend cap (blocks new outbound calls)</span><input type="number" min={0} value={ts.spend_cap_daily ?? ''} onChange={(e) => patch({ spend_cap_daily: numberOrNull(e.target.value) })} /></label>
        <label><span>Alert when one officer places this many calls in an hour</span><input type="number" min={5} max={5000} value={ts.fraud_calls_per_hour} onChange={(e) => patch({ fraud_calls_per_hour: Number(e.target.value) })} /></label>
        <label><span>Keep call recordings (days)</span><input type="number" min={1} max={3650} value={ts.recording_retention_days} onChange={(e) => patch({ recording_retention_days: Number(e.target.value) })} /></label>
        <label><span>Keep voicemails (days)</span><input type="number" min={1} max={3650} value={ts.voicemail_retention_days} onChange={(e) => patch({ voicemail_retention_days: Number(e.target.value) })} /></label>
      </div>
      <p className="sccMuted">Your legal team must confirm the retention period before recording is switched on. Shortening it deletes older recordings on the next maintenance run and cannot be undone.</p>
      <button type="button" className="sccVoicePrimary" disabled={busy} onClick={() => void saveSettings({
        dncEnforced: ts.dnc_enforced, byocFallbackToPstn: ts.byoc_fallback_to_pstn, spendAlertDaily: ts.spend_alert_daily, spendCapDaily: ts.spend_cap_daily,
        fraudCallsPerHour: ts.fraud_calls_per_hour, recordingRetentionDays: ts.recording_retention_days, voicemailRetentionDays: ts.voicemail_retention_days,
      }, 'Safety settings saved.')}><Save size={15} />Save safety settings</button>
    </> : null}
  </div>
}

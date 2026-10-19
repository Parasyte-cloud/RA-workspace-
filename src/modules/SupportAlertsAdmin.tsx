// Administration: who gets alerted, how, and whether it is actually working.
//
// PArAsYtE | RA-Workspace support module

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import {
  loadAlertRules, loadDeliveryReport, loadStaffContacts, saveAlertRule, saveStaffContact,
  type AlertRule, type DeliveryReport,
} from '../lib/supportCommandCentre'
import '../support-command-centre.css'

type Person = { id: string; full_name: string }

const KIND_TEXT: Record<string, string> = {
  sos_new: 'New SOS',
  sos_unassigned: 'SOS with no responder',
  sos_escalated: 'SOS not acknowledged (escalated)',
  sos_reassigned: 'SOS handed to a new responder',
  sos_followup: 'SOS follow-up due',
  sos_repeat: 'SOS pressed again',
  location_pending: 'Location request needs approval',
  ticket_urgent: 'P0 or P1 ticket assigned',
}
const AUDIENCE_TEXT = { responder: 'The responder or owner', supervisors: 'Supervisors', on_duty: 'Everyone on duty' } as const
const CHANNEL_TEXT = { push: 'Push', sms: 'Text', whatsapp: 'WhatsApp', voice: 'Call' } as const

export default function SupportAlertsAdmin({ employees }: { employees: Person[] }) {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [report, setReport] = useState<DeliveryReport | null>(null)
  const [contacts, setContacts] = useState<Array<{ employee_id: string; phone: string | null; allow_sms: boolean; allow_whatsapp: boolean; allow_voice: boolean }>>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [personId, setPersonId] = useState('')
  const [phone, setPhone] = useState('')

  const load = useCallback(async () => {
    try {
      const [r, d, c] = await Promise.all([loadAlertRules(), loadDeliveryReport(), loadStaffContacts()])
      setRules(r); setReport(d); setContacts(c)
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load alerts') }
  }, [])
  useEffect(() => { void load() }, [load])

  const grouped = useMemo(() => {
    const m = new Map<string, AlertRule[]>()
    for (const r of rules) m.set(r.kind, [...(m.get(r.kind) || []), r])
    return [...m.entries()].filter(([k]) => KIND_TEXT[k])
  }, [rules])

  const change = async (rule: AlertRule, patch: { enabled?: boolean; delaySeconds?: number; minLevel?: number }) => {
    setBusy(true); setNotice('')
    try { await saveAlertRule(rule.id, patch); await load() } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }

  const existing = contacts.find((c) => c.employee_id === personId)
  useEffect(() => { setPhone(existing?.phone || '') }, [personId, existing?.phone])

  const total = (report?.by_channel || []).reduce((n, c) => n + c.sent + c.failed, 0)

  return <div className="supportAdminEditor sccPanel">
    <h4>Alerts outside the screen <button type="button" className="sccIconBtn" onClick={() => void load()}><RefreshCw size={14} />Refresh</button></h4>
    <p className="sccHealthNote">When an emergency or an urgent job needs a person, these rules decide who is told, how, and after how many seconds. Acknowledging an emergency cancels the calls and texts that have not gone out yet. Push needs each person to turn alerts on in their browser; text, WhatsApp and calls need their number below.</p>
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}

    <h4>Is it working? (last 7 days)</h4>
    {report ? <>
      <div className="sccFacts" style={{ padding: '0 0 8px' }}>
        {report.by_channel.length === 0 ? <div className="sccEmpty">Nothing has been sent yet.</div> : report.by_channel.map((c) => <span key={c.channel}>
          <small>{CHANNEL_TEXT[c.channel]}</small><b>{c.sent} sent</b>
          <small>{c.failed} failed, {c.skipped} skipped{c.queued ? `, ${c.queued} waiting` : ''}</small>
        </span>)}
      </div>
      {report.oldest_queued_seconds && report.oldest_queued_seconds > 120 ? <div className="sccNotice">Alerts have been waiting {Math.round(report.oldest_queued_seconds / 60)} minutes. Check that the support-maintenance job is running every minute.</div> : null}
      {total === 0 && report.by_channel.length > 0 ? <p className="sccHealthNote">Skipped means the person had no device or number for that channel. Fix those below.</p> : null}
      {report.staff_without_path.length ? <div className="sccNotice" role="alert">
        <span><b>{report.staff_without_path.length} {report.staff_without_path.length === 1 ? 'person has' : 'people have'} no way to be alerted off-screen:</b> {report.staff_without_path.map((p) => p.name).join(', ')}.</span>
      </div> : <p className="sccHealthNote">Everyone on the team has at least one way to be reached.</p>}
      {report.recent_problems.length ? <>
        <h4>Recent problems</h4>
        {report.recent_problems.slice(0, 12).map((p, i) => <div key={i} className="sccAuditRow">
          <span><b>{p.recipient}</b><small>{new Date(p.at).toLocaleString()}</small></span>
          <span><b>{CHANNEL_TEXT[p.channel]} {p.status}</b><small>{KIND_TEXT[p.kind] || p.kind}</small></span>
          <span><small>{p.error || 'no detail'}</small></span>
        </div>)}
      </> : null}
    </> : <div className="sccEmpty">Loading.</div>}

    <h4>Someone's phone number</h4>
    <div className="supportAdminForm">
      <label><span>Person</span>
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">Choose</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
      <label><span>Mobile number</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 801 234 5678" disabled={!personId} /></label>
    </div>
    <button type="button" className="sccVoicePrimary" disabled={busy || !personId} onClick={async () => {
      setBusy(true); setNotice('')
      try { await saveStaffContact(personId, { phone, allowSms: existing?.allow_sms ?? true, allowWhatsapp: existing?.allow_whatsapp ?? true, allowVoice: existing?.allow_voice ?? true }); setNotice('Saved.'); await load() }
      catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
    }}><Save size={15} />Save number</button>

    <h4>Rules</h4>
    {grouped.map(([kind, list]) => <div key={kind} className="sccLoc" style={{ marginBottom: 10 }}>
      <b>{KIND_TEXT[kind]}</b>
      {list.map((r) => <div key={r.id} className="sccAuditRow" style={{ gridTemplateColumns: 'minmax(140px,1.2fr) minmax(90px,.8fr) minmax(0,2fr)' }}>
        <span><b>{AUDIENCE_TEXT[r.audience]}</b></span>
        <label className="sccCheck"><input type="checkbox" checked={r.enabled} disabled={busy} onChange={(e) => void change(r, { enabled: e.target.checked })} /><span>{CHANNEL_TEXT[r.channel]}</span></label>
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="sccField"><small>Wait (seconds)</small>
            <input type="number" min={0} max={3600} defaultValue={r.delay_seconds} disabled={busy} style={{ width: 90 }}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== r.delay_seconds) void change(r, { delaySeconds: v }) }} /></label>
          {kind === 'sos_escalated' ? <label className="sccField"><small>From level</small>
            <input type="number" min={0} max={10} defaultValue={r.min_level} disabled={busy} style={{ width: 70 }}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== r.min_level) void change(r, { minLevel: v }) }} /></label> : null}
        </span>
      </div>)}
    </div>)}
  </div>
}

// Administration: invite Support staff who have no RideArrivo mailbox.
// An invite creates a one-time code that is emailed, sent on WhatsApp, or read out by the admin.
// The code is shown once on this screen and never stored in readable form.
//
// PArAsYtE | RA-Workspace support module

import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, MailPlus, RefreshCw, RotateCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  createInvite, delegateInvites, listInvites, resendInvite, revokeInvite,
  type InviteOutcome, type InviteRole, type StaffInvite,
} from '../lib/supportCommandCentre'
import '../support-command-centre.css'

type Person = { id: string; full_name: string; email: string }
type AgentLite = { employee_id: string; enabled: boolean; is_supervisor: boolean; can_invite?: boolean }

const ROLE_TEXT: Record<InviteRole, string> = {
  agent: 'Officer: takes calls, chats and tickets',
  watcher: 'Watcher: sees queues, never gets work or private details',
  supervisor: 'Supervisor: runs the floor and the control tower',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

type TeamLite = { id: string; name: string; active: boolean }

export default function SupportInvites({ employees, agents, teams = [], onChanged }: { employees: Person[]; agents: AgentLite[]; teams?: TeamLite[]; onChanged?: () => void }) {
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [issued, setIssued] = useState<(InviteOutcome & { name: string; email: string }) | null>(null)
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', roleKind: 'agent' as InviteRole, jobTitle: 'Support Officer', teamId: '', viaEmail: true, viaWhatsApp: false })

  const load = useCallback(async () => {
    try { setInvites(await listInvites()) } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load invites') }
  }, [])
  useEffect(() => { void load() }, [load])

  const channelsOf = (email: boolean, wa: boolean) => [...(email ? ['email' as const] : []), ...(wa ? ['whatsapp' as const] : [])]
  const summarise = (o: InviteOutcome) => {
    const parts = Object.entries(o.delivery).map(([ch, r]) => `${ch === 'email' ? 'Email' : 'WhatsApp'}: ${r.ok ? 'sent' : `not sent (${r.detail})`}`)
    return parts.length ? parts.join('. ') + '.' : 'Nothing was sent. Give the code to the person yourself.'
  }

  const send = async () => {
    setBusy(true); setNotice('')
    try {
      const out = await createInvite({
        email: form.email, fullName: form.fullName, phone: form.phone, roleKind: form.roleKind, jobTitle: form.jobTitle, teamId: form.teamId || undefined,
        channels: channelsOf(form.viaEmail, form.viaWhatsApp),
      })
      setIssued({ ...out, name: form.fullName, email: form.email })
      setNotice(summarise(out))
      setForm({ ...form, fullName: '', email: '', phone: '' })
      await load(); onChanged?.()
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not create the invite') } finally { setBusy(false) }
  }

  const resend = async (inv: StaffInvite) => {
    setBusy(true); setNotice('')
    try {
      const out = await resendInvite(inv.id, channelsOf(true, Boolean(inv.phone)))
      setIssued({ ...out, name: inv.full_name, email: inv.email })
      setNotice('New code issued. The old one no longer works. ' + summarise(out))
      await load()
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not resend') } finally { setBusy(false) }
  }

  const revoke = async (inv: StaffInvite) => {
    if (!window.confirm(`Cancel the invite for ${inv.full_name}? Their code will stop working.`)) return
    setBusy(true); setNotice('')
    try { await revokeInvite(inv.id); setNotice('Invite cancelled.'); await load() }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Could not cancel') } finally { setBusy(false) }
  }

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice('Copied.') } catch { setNotice('Copy failed. Select the text and copy it by hand.') }
  }

  const supervisors = agents.filter((a) => a.enabled && a.is_supervisor)
  const nameOf = (id: string) => employees.find((e) => e.id === id)
  const toggleDelegate = async (id: string, value: boolean) => {
    setBusy(true); setNotice('')
    try { await delegateInvites(id, value); setNotice(value ? 'Invite rights granted.' : 'Invite rights withdrawn.'); onChanged?.() }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Could not change invite rights') } finally { setBusy(false) }
  }

  const ready = form.fullName.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) && (!form.viaWhatsApp || form.phone.trim().length >= 8)

  return <div className="supportAdminEditor sccPanel">
    <h4><MailPlus size={16} /> Invite someone to Support</h4>
    <p className="sccHealthNote">For staff joining Support with a personal email. They verify a one-time code; new users create a password, while anyone with an existing RideArrivo account keeps their existing account password. Codes work once, for one email, for 48 hours.</p>
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}

    <div className="supportAdminForm">
      <label><span>Full name</span><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoComplete="off" /></label>
      <label><span>Their personal email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></label>
      <label><span>WhatsApp number (optional)</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234 801 234 5678" autoComplete="off" /></label>
      <label><span>Job title</span><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></label>
      <label className="wide"><span>Access</span>
        <select value={form.roleKind} onChange={(e) => setForm({ ...form, roleKind: e.target.value as InviteRole })}>
          {(Object.keys(ROLE_TEXT) as InviteRole[]).map((r) => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}
        </select>
      </label>
      {teams.length ? <label><span>Team</span>
        <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}><option value="">No team</option>{teams.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label> : null}
      <label className="sccCheck"><input type="checkbox" checked={form.viaEmail} onChange={(e) => setForm({ ...form, viaEmail: e.target.checked })} /><span>Send by email from RideArrivo</span></label>
      <label className="sccCheck"><input type="checkbox" checked={form.viaWhatsApp} onChange={(e) => setForm({ ...form, viaWhatsApp: e.target.checked })} /><span>Send on WhatsApp</span></label>
    </div>
    <button type="button" className="sccVoicePrimary" disabled={busy || !ready} onClick={() => void send()}><KeyRound size={15} />Create invite</button>

    {issued ? <div className="sccLoc" style={{ marginTop: 14 }}>
      <b>One-time code for {issued.name}</b>
      <span style={{ fontSize: '1.6rem', letterSpacing: '0.12em', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{issued.code}</span>
      <small>Shown once. If the email or WhatsApp did not arrive, read this out or send it yourself. Valid until {when(issued.expiresAt)}.{issued.joinUrl ? ` Join page: ${issued.joinUrl}` : ' Set SUPPORT_JOIN_URL so messages carry the join link.'}</small>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void copy(issued.code)}><Copy size={14} />Copy code</button>
        {issued.joinUrl ? <button type="button" onClick={() => void copy(`${issued.joinUrl}\nEmail: ${issued.email}\nCode: ${issued.code}`)}><Copy size={14} />Copy link and code</button> : null}
        <button type="button" onClick={() => setIssued(null)}>Hide</button>
      </div>
    </div> : null}

    <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Invites <button type="button" className="sccIconBtn" onClick={() => void load()}><RefreshCw size={14} />Refresh</button></h4>
    {invites.length === 0 ? <div className="sccEmpty">No invites yet.</div> : invites.map((inv) => <div key={inv.id} className="sccAuditRow">
      <span><b>{inv.full_name}</b><small>{inv.email}{inv.phone ? ` · ${inv.phone}` : ''}</small></span>
      <span>
        <b style={{ textTransform: 'capitalize' }}>
          {inv.security_state === 'held' ? 'Security hold' : inv.security_state === 'cooldown' ? 'Cooling down' : inv.status}
        </b>
        <small>
          {inv.role_kind} · {inv.security_state === 'held'
            ? 'reissue required'
            : inv.security_state === 'cooldown'
              ? `retry after ${when(inv.cooldown_until)}`
              : inv.status === 'pending'
                ? `expires ${when(inv.expires_at)}`
                : inv.status === 'redeemed'
                  ? `joined ${when(inv.redeemed_at)}`
                  : `created ${when(inv.created_at)}`}
        </small>
      </span>
      <span>
        <small>
          Sent {inv.send_count} time{inv.send_count === 1 ? '' : 's'}; last {when(inv.last_sent_at)}. {Object.entries(inv.delivery || {}).map(([ch, r]) => `${ch}: ${r.ok ? 'ok' : r.detail}`).join('; ')}
          {inv.security_state === 'held' ? ' Reissue this invitation to clear the security hold.' : inv.security_state === 'cooldown' ? ' Verification is temporarily paused.' : inv.attempts ? ` Wrong guesses: ${inv.attempts}.` : ''}
        </small>
        {inv.status !== 'redeemed' ? <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="sccIconBtn" disabled={busy} onClick={() => void resend(inv)}><RotateCw size={14} />{inv.security_state === 'held' || inv.status === 'locked' ? 'Reissue' : 'New code'}</button>
          {inv.status === 'pending' ? <button type="button" className="sccIconBtn" disabled={busy} onClick={() => void revoke(inv)}><Trash2 size={14} />Cancel</button> : null}
        </span> : null}
      </span>
    </div>)}

    {supervisors.length ? <>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={16} /> Who else may invite</h4>
      <p className="sccHealthNote">Only administrators can change this. A supervisor with invite rights can bring in officers and watchers, never other supervisors.</p>
      {supervisors.map((s) => <label key={s.employee_id} className="sccCheck sccPad">
        <input type="checkbox" checked={Boolean(s.can_invite)} disabled={busy} onChange={(e) => void toggleDelegate(s.employee_id, e.target.checked)} />
        <span>{nameOf(s.employee_id)?.full_name || s.employee_id}</span>
      </label>)}
    </> : null}
  </div>
}

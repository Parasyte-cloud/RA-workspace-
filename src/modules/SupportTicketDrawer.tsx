import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Eye, EyeOff, Mail, MessageSquare, Phone, PhoneCall, PhoneForwarded, StickyNote, Voicemail, X } from 'lucide-react'
import SupportLocationPanel from './SupportLocationPanel'
import {
  addNote, assignTicket, claimTicket, control, dueLabel, fetchRecordingUrl, formatDuration, getTicketDetail, label, loadTicketCalls, loadWatchers, queueCallback, timeAgo, unwatchTicket, updateTicket, watchTicket,
  type SupportAgentPresence, type TicketCall, type SupportPriority, type SupportTicketDetail, type SupportTicketStatus,
} from '../lib/supportCommandCentre'
import SupportComplaintPanel from './SupportComplaintPanel'

type Props = {
  ticketId: string
  meId: string | null
  isSupervisor: boolean
  canSeeSensitive: boolean
  agents: SupportAgentPresence[]
  onClose: () => void
  onChanged: () => void
  onCall: (to: string, ticketId: string) => void
}

const PRIORITIES: SupportPriority[] = ['P0', 'P1', 'P2', 'P3', 'P4']
const STATUS_ACTIONS: Array<{ status: SupportTicketStatus; text: string }> = [
  { status: 'in_progress', text: 'In progress' },
  { status: 'waiting_customer', text: 'Waiting on customer' },
  { status: 'waiting_internal', text: 'Waiting internally' },
  { status: 'escalated', text: 'Escalate' },
  { status: 'resolved', text: 'Resolve' },
]

type Entry = { key: string; at: string; kind: 'message' | 'note' | 'event'; who: string; body: string; inbound?: boolean }

function timeline(detail: SupportTicketDetail): Entry[] {
  const out: Entry[] = []
  for (const i of detail.interactions) {
    out.push({ key: 'i' + i.id, at: i.occurred_at, kind: 'message', who: i.direction === 'inbound' ? (detail.customer?.display_name || 'Customer') : 'RideArrivo', body: i.body || `(${label(i.channel)} ${i.direction})`, inbound: i.direction === 'inbound' })
  }
  for (const n of detail.notes) out.push({ key: 'n' + n.id, at: n.created_at, kind: 'note', who: n.author_name || 'Officer', body: n.body })
  const quiet = new Set(['note_added'])
  for (const e of detail.events) if (!quiet.has(e.event_type)) out.push({ key: 'e' + e.id, at: e.created_at, kind: 'event', who: e.actor_name || 'System', body: label(e.event_type) })
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

export default function SupportTicketDrawer({ ticketId, meId, isSupervisor, canSeeSensitive, agents, onClose, onChanged, onCall }: Props) {
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [note, setNote] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [calls, setCalls] = useState<TicketCall[]>([])
  const [audio, setAudio] = useState<{ callId: string; url: string } | null>(null)
  const [watchers, setWatchers] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      setDetail(await getTicketDetail(ticketId)); setNotice('')
      setCalls(await loadTicketCalls(ticketId).catch(() => []))
      setWatchers(await loadWatchers(ticketId).catch(() => []))
    }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load the ticket.') }
    finally { setLoading(false) }
  }, [ticketId])

  useEffect(() => { setLoading(true); void load() }, [load])
  // Object URLs hold the audio in memory; release them when the drawer closes or another clip loads.
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url) }, [audio])

  const play = async (callId: string) => {
    setBusy(true); setNotice('')
    try { setAudio({ callId, url: await fetchRecordingUrl(callId) }) }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Could not play that recording.') }
    finally { setBusy(false) }
  }

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true); setNotice('')
    try { await work(); await load(); onChanged(); if (done) setNotice(done) }
    catch (e) { setNotice(e instanceof Error ? e.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  const t = detail?.ticket
  const mine = Boolean(t && meId && t.assigned_agent_id === meId)
  const phone = detail?.customer?.primary_phone || t?.customer_phone || null
  const email = detail?.customer?.primary_email || t?.customer_email || null
  const entries = useMemo(() => (detail ? timeline(detail) : []), [detail])
  const closed = t?.status === 'resolved' || t?.status === 'closed'

  return <div className="sccDrawerBackdrop" onClick={onClose}>
    <aside className="sccDrawer" role="dialog" aria-label="Ticket" onClick={(e) => e.stopPropagation()}>
      <header className="sccDrawerHead">
        <div>
          <span className="sccEyebrow">{t?.public_id || 'Ticket'} · {label(t?.channel)}</span>
          <h3>{t?.subject || (loading ? 'Loading' : 'Ticket not found')}</h3>
          {t ? <small>{label(t.status)} · {t.assigned_agent_name || 'Unassigned'} · {t.sla_state === 'breached' || t.sla_state === 'at_risk' ? <b className={`sccSla ${t.sla_state}`}>SLA {label(t.sla_state)}</b> : 'SLA ok'}{t.first_response_due_at && !t.first_responded_at ? ` · first reply ${dueLabel(t.first_response_due_at)}` : ''}</small> : null}
        </div>
        <button type="button" className="sccIconBtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      {notice ? <div className="sccNotice">{notice}</div> : null}

      {t ? <>
        <div className="sccDrawerBar">
          {!mine && !closed ? <button type="button" className="sccVoicePrimary" disabled={busy} onClick={() => void act(() => claimTicket(t.id), 'Ticket is yours.')}>Take ticket</button> : null}
          {STATUS_ACTIONS.filter((a) => a.status !== t.status).map((a) => (
            <button type="button" key={a.status} disabled={busy || closed && a.status !== 'in_progress'} onClick={() => void act(() => updateTicket(t.id, { status: a.status }))}>{a.text}</button>
          ))}
          {closed ? <button type="button" disabled={busy} onClick={() => void act(() => updateTicket(t.id, { status: 'reopened' }))}>Reopen</button> : null}
          {meId ? (watchers.includes(meId)
            ? <button type="button" disabled={busy} onClick={() => void act(() => unwatchTicket(t.id), 'You stopped watching this ticket.')}><EyeOff size={14} /> Unwatch</button>
            : <button type="button" disabled={busy} onClick={() => void act(() => watchTicket(t.id), 'You are watching this ticket. Watching shows you its activity; it does not make you the owner.')}><Eye size={14} /> Watch</button>) : null}
          <select value={t.priority} disabled={busy} onChange={(e) => void act(() => updateTicket(t.id, { priority: e.target.value as SupportPriority }))} aria-label="Priority">{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          {isSupervisor ? <select value={t.assigned_agent_id || ''} disabled={busy} onChange={(e) => void act(() => assignTicket(t.id, e.target.value || null))} aria-label="Assign to">
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.employee_id} value={a.employee_id}>{a.display_name}</option>)}
          </select> : null}
        </div>

        <section className="sccDrawerCustomer">
          <strong>{detail?.customer?.display_name || t.customer_name || 'Unknown customer'}</strong>
          <span>{detail?.customer?.ticket_count ? `${detail.customer.ticket_count} ticket${detail.customer.ticket_count === 1 ? '' : 's'}` : ''}</span>
          <div className="sccContactRow">
            {phone ? <>
              <button type="button" onClick={() => onCall(phone, t.id)}><PhoneCall size={14} />Call {phone}</button>
              <button type="button" disabled={busy} onClick={() => void act(() => queueCallback({ ticketId: t.id, phoneNumber: phone, notBefore: callbackAt ? new Date(callbackAt).toISOString() : undefined }), callbackAt ? 'Callback scheduled.' : 'Callback queued.')}><PhoneForwarded size={14} />Queue callback</button>
              <label className="sccInline"><CalendarClock size={14} /><input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} aria-label="Callback time (optional)" /></label>
            </> : <span className="sccMuted"><Phone size={14} /> No phone number on file</span>}
            {phone ? <button type="button" disabled={busy} onClick={() => void act(() => control({ action: 'dnc_add', phoneNumber: phone, reason: `Customer asked to stop calls (${t.public_id})` }), 'Added to the do not contact list. Outbound calls to this number are now blocked.')}>Do not contact</button> : null}
            {email ? <a className="sccLinkBtn" href={`mailto:${email}?subject=${encodeURIComponent(`Re: ${t.subject} [${t.public_id}]`)}`}><Mail size={14} />Email</a> : null}
          </div>
          {t.channel === 'whatsapp' || t.channel === 'sms' ? <p className="sccMuted"><MessageSquare size={13} /> Reply to {label(t.channel)} customers from the {t.channel === 'whatsapp' ? 'WhatsApp panel' : 'messaging tools'} below; the thread appears here automatically.</p> : null}
        </section>

        <SupportComplaintPanel ticketId={t.id} status={t.status} isSupervisor={isSupervisor} customer={{ id: detail?.customer?.id ?? t.customer_id ?? null, name: detail?.customer?.display_name || t.customer_name || null, phone, email }} onChanged={() => { void load(); onChanged() }} />

        {canSeeSensitive && !closed && (mine || isSupervisor) ? <SupportLocationPanel ticketId={t.id} meId={meId} /> : null}

        {calls.some((c) => c.recording_sid || c.is_voicemail) ? <section className="sccRelated" aria-label="Recordings">
          <strong><Voicemail size={13} /> Recordings and voicemail</strong>
          {calls.filter((c) => c.recording_sid || c.is_voicemail).map((c) => <span key={c.id} className="sccInline">
            {c.is_voicemail ? 'Voicemail' : label(c.direction)} · {timeAgo(c.started_at)}{c.duration_seconds ? ` · ${formatDuration(c.duration_seconds)}` : ''}
            {c.recording_deleted_at ? <em> removed after retention period</em> : c.recording_sid ? <button type="button" className="sccIconBtn" disabled={busy} onClick={() => void play(c.id)}>Play</button> : null}
            {audio?.callId === c.id ? <audio controls autoPlay src={audio.url} /> : null}
          </span>)}
          <small className="sccMuted">Each play is logged against your name.</small>
        </section> : null}

        <section className="sccTimeline" aria-label="Conversation">
          {entries.length ? entries.map((e) => <article key={e.key} className={`sccEntry ${e.kind} ${e.inbound ? 'in' : ''}`}>
            <header><b>{e.kind === 'note' ? <><StickyNote size={12} /> Internal note · {e.who}</> : e.who}</b><small>{timeAgo(e.at)}</small></header>
            <p>{e.body}</p>
          </article>) : <div className="sccEmpty">No activity yet.</div>}
        </section>

        <form className="sccNoteForm" onSubmit={(ev) => { ev.preventDefault(); if (note.trim()) void act(() => addNote(t.id, note).then(() => setNote(''))) }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note (customers never see this)" rows={2} maxLength={4000} />
          <button type="submit" disabled={busy || !note.trim()}>Add note</button>
        </form>

        {detail?.related.length ? <section className="sccRelated"><strong>Earlier tickets</strong>{detail.related.map((r) => <span key={r.id}>{r.public_id} · {r.subject} · {label(r.status)}</span>)}</section> : null}
      </> : loading ? <div className="sccEmpty">Loading</div> : null}
    </aside>
  </div>
}

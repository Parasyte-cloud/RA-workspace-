import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock3, Headphones, Inbox, PhoneForwarded, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import {
  dueLabel, formatDuration, label, SELECTABLE_STATES, timeAgo,
  type SupportAgentState, type SupportChannel, type SupportTicketSummary,
} from '../lib/supportCommandCentre'
import { useSupportCentre } from '../support/useSupportCentre'
import SupportSoftphone, { type DialRequest } from './SupportSoftphone'
import SupportTicketDrawer from './SupportTicketDrawer'
import SupportControlTower from './SupportControlTower'
import SupportEmergencyBanner from './SupportEmergencyBanner'
import SupportEmergencyConsole from './SupportEmergencyConsole'
import SupportLookup from './SupportLookup'
import SupportInsights from './SupportInsights'
import SupportDriverOutreach from './SupportDriverOutreach'
import { useSupportIncidents } from '../support/useSupportIncidents'
import { useSupportNotifications } from '../support/useSupportNotifications'
import { ensureManifest, onWorkerOpen, registerWorker } from '../support/pwa'
import SupportNotificationCentre from './SupportNotificationCentre'
import type { NotificationRow } from '../lib/supportCommandCentre'
import '../support-command-centre.css'

type Tab = 'mine' | 'queue' | 'calls' | 'callbacks' | 'outreach' | 'emergency' | 'lookup' | 'tower' | 'insights'
const CHANNELS: Array<'all' | SupportChannel> = ['all', 'voice', 'whatsapp', 'web_chat', 'email', 'sms', 'form']

function TicketCard({ t, onOpen }: { t: SupportTicketSummary; onOpen: (id: string) => void }) {
  return <button type="button" className="sccTicket" onClick={() => onOpen(t.id)}>
    <div><span className={`sccPriority ${t.priority.toLowerCase()}`}>{t.priority}</span><b>{t.public_id}</b><small>{label(t.channel)}</small>{t.sla_state === 'breached' || t.sla_state === 'at_risk' ? <em className={`sccSla ${t.sla_state}`}>{label(t.sla_state)}</em> : null}</div>
    <strong>{t.subject}</strong>
    <p>{t.customer_name || t.customer_phone || t.customer_email || 'Unknown customer'}</p>
    <footer><span>{label(t.status)}</span><span>{t.first_responded_at ? timeAgo(t.last_customer_message_at || t.updated_at) : dueLabel(t.first_response_due_at)}</span><span>{t.assigned_agent_name || 'Unassigned'}</span></footer>
  </button>
}

export default function SupportCommandCentre() {
  const { snapshot, me, meId, loading, error, reload, changeState, setError } = useSupportCentre()
  const [tab, setTab] = useState<Tab>('mine')
  const [channel, setChannel] = useState<'all' | SupportChannel>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [dial, setDial] = useState<DialRequest | null>(null)
  const [voiceReady, setVoiceReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [focusIncident, setFocusIncident] = useState<string | null>(null)

  const provisioned = me?.provisioned !== false

  // Alerts outside the screen: installable app, service worker, notification centre.
  const jumpTo = useCallback((t: { tab: string | null; entityId?: string | null; entityType?: string | null }) => {
    const wanted = t.tab as Tab | null
    if (wanted && ['mine', 'queue', 'calls', 'callbacks', 'outreach', 'emergency', 'lookup', 'tower', 'insights'].includes(wanted)) setTab(wanted)
    if (t.entityType === 'incident' && t.entityId) { setFocusIncident(t.entityId); setTab('emergency') }
    else if (t.entityType === 'ticket' && t.entityId) setOpenId(t.entityId)
  }, [])
  const alertBeep = useCallback((n: NotificationRow) => {
    // A short tone so an emergency is heard from across the room. Browsers may refuse before the first click; that is fine.
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx(); const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'square'; osc.frequency.value = 880; gain.gain.value = 0.08
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.35)
      setTimeout(() => void ctx.close(), 600)
    } catch { /* silent */ }
    const old = document.title; document.title = `ALERT: ${n.title}`
    setTimeout(() => { document.title = old }, 6000)
  }, [])
  const notes = useSupportNotifications(provisioned, alertBeep)
  useEffect(() => {
    if (!provisioned) return
    ensureManifest(); void registerWorker()
    const q = new URLSearchParams(window.location.search)
    const wanted = q.get('support_open')
    if (wanted) { jumpTo({ tab: wanted }); q.delete('support_open'); const rest = q.toString(); window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash) }
    return onWorkerOpen((t) => jumpTo({ tab: t.tab, entityType: t.entityType, entityId: t.entityId }))
  }, [provisioned, jumpTo])
  const myState: SupportAgentState = (me?.state as SupportAgentState) || 'offline'
  const isSupervisor = Boolean(me?.supervisor)
  const incidents = useSupportIncidents(!loading && (me?.provisioned !== false || Boolean(me?.supervisor)))
  const myRow = snapshot.agents.find((a) => a.employee_id === meId) ?? null
  const voiceEnabled = (myRow?.voice_capacity ?? 1) > 0

  const ringing = useMemo(
    () => snapshot.calls.find((c) => c.ringing_agent_id === meId && !c.ended_at && !c.answered_at) ?? null,
    [snapshot.calls, meId],
  )

  const byChannel = (list: SupportTicketSummary[]) => (channel === 'all' ? list : list.filter((t) => t.channel === channel))
  const open = snapshot.tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed')
  const mine = byChannel(open.filter((t) => t.assigned_agent_id === meId))
  const queue = byChannel(open.filter((t) => !t.assigned_agent_id))
  const waiting = snapshot.queues.reduce((s, q) => s + q.waiting, 0)
  const atRisk = open.filter((t) => t.sla_state === 'at_risk' || t.sla_state === 'breached').length

  const pick = async (next: SupportAgentState) => {
    setBusy(true); setError('')
    try {
      if (next === 'available' && voiceEnabled && !voiceReady) {
        throw new Error('Start the softphone before going Available, or calls will ring a browser that cannot answer.')
      }
      await changeState(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to change status.')
    } finally { setBusy(false) }
  }

  if (!loading && !provisioned) {
    return <section className="sccShell" aria-label="Support Command Centre">
      <SupportEmergencyBanner open={incidents.open} canAct={incidents.sensitive} disconnected={incidents.disconnected} onOpen={() => undefined} onChanged={incidents.reload} />
      <div className="sccEmpty"><ShieldCheck size={20} /><p>You are not set up as a Support officer yet. Ask your Head of Support to provision you in Administration, Support Routing.</p></div>
    </section>
  }

  const locked = myState === 'on_call' || myState === 'wrap_up' || myState === 'busy'

  return <section className="sccShell" aria-label="Support Command Centre">
    <header className="sccHeader">
      <div><span className="sccEyebrow">RA Support</span><h2>Support Command Centre</h2><p>Voice, WhatsApp, chat, email, SMS and forms in one queue.</p></div>
      <div className="sccHeaderActions">
        <label>My status
          <select value={locked ? myState : SELECTABLE_STATES.includes(myState) ? myState : 'offline'} onChange={(e) => void pick(e.target.value as SupportAgentState)} disabled={busy || locked}>
            {locked ? <option value={myState}>{label(myState)}</option> : null}
            {SELECTABLE_STATES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <span className={`sccShiftBadge ${me?.on_shift ? 'on' : ''}`}><Clock3 size={13} />{me?.on_shift ? 'On shift' : 'Off shift'}</span>
        <SupportNotificationCentre items={notes.items} unread={notes.unread} error={notes.error} onRead={(ids) => void notes.markRead(ids)}
          onOpen={(n) => jumpTo({ tab: (n.data?.tab as string | undefined) ?? null, entityType: n.entity_type, entityId: n.entity_id })} />
        <button type="button" onClick={() => void reload()} disabled={loading}><RefreshCw size={16} />{loading ? 'Loading' : 'Refresh'}</button>
      </div>
    </header>

    {error ? <div className="sccNotice" role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}
    {myState === 'offline' && me?.reason === 'stale_heartbeat' ? <div className="sccNotice"><AlertTriangle size={16} /><span>You were set Offline because this page stopped checking in. Set yourself Available again.</span></div> : null}

    <SupportEmergencyBanner open={incidents.open} canAct={incidents.sensitive} disconnected={incidents.disconnected}
      onOpen={(id) => { setFocusIncident(id); setTab('emergency') }} onChanged={incidents.reload} />

    <SupportSoftphone ringing={ringing} dialRequest={dial} voiceEnabled={voiceEnabled} onStateChange={(s) => setVoiceReady(s === 'ready' || s === 'incoming' || s === 'on_call' || s === 'connecting')} />

    <div className="sccMetrics">
      <article><UsersRound /><span>Available</span><strong>{snapshot.agents.filter((a) => a.state === 'available' && a.active_shift).length}</strong></article>
      <article><Headphones /><span>On calls</span><strong>{snapshot.agents.reduce((s, a) => s + a.voice_active, 0)}</strong></article>
      <article><Inbox /><span>Waiting</span><strong>{waiting}</strong></article>
      <article><PhoneForwarded /><span>Callbacks</span><strong>{snapshot.callbacks.filter((c) => ['scheduled', 'queued', 'reserved', 'calling'].includes(c.status)).length}</strong></article>
      <article className={atRisk ? 'bad' : ''}><AlertTriangle /><span>SLA at risk</span><strong>{atRisk}</strong></article>
    </div>

    <nav className="sccTabs" aria-label="Views">
      {([['mine', `My work (${mine.length})`], ['queue', `Queue (${queue.length})`], ['calls', 'Calls'], ['callbacks', 'Callbacks'], ['outreach', 'Driver outreach']] as Array<[Tab, string]>).map(([id, text]) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{text}</button>)}
      <button type="button" className={`${tab === 'emergency' ? 'active' : ''} ${incidents.open.length ? 'alert' : ''}`} onClick={() => setTab('emergency')}>Emergency{incidents.open.length ? ` (${incidents.open.length})` : ''}</button>
      {incidents.sensitive ? <button type="button" className={tab === 'lookup' ? 'active' : ''} onClick={() => setTab('lookup')}>Lookup</button> : null}
      {isSupervisor ? <button type="button" className={tab === 'tower' ? 'active' : ''} onClick={() => setTab('tower')}>Control tower</button> : null}
      {isSupervisor ? <button type="button" className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}>Insights</button> : null}
      {(tab === 'mine' || tab === 'queue') ? <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} aria-label="Channel">{CHANNELS.map((c) => <option key={c} value={c}>{c === 'all' ? 'All channels' : label(c)}</option>)}</select> : null}
    </nav>

    {tab === 'mine' ? <div className="sccTicketList">{mine.length ? mine.map((t) => <TicketCard key={t.id} t={t} onOpen={setOpenId} />) : <div className="sccEmpty">Nothing assigned to you. New work arrives here automatically while you are Available.</div>}</div> : null}
    {tab === 'queue' ? <div className="sccTicketList">{queue.length ? queue.map((t) => <TicketCard key={t.id} t={t} onOpen={setOpenId} />) : <div className="sccEmpty">The queue is empty.</div>}</div> : null}

    {tab === 'calls' ? <div className="sccPanel">{snapshot.calls.length ? snapshot.calls.map((c) => <button type="button" key={c.id} className="sccQueue" onClick={() => c.ticket_id && setOpenId(c.ticket_id)}>
      <span><b>{c.customer_name || c.from_number || c.to_number || 'Unknown'}</b><small>{c.direction} · {label(c.abandoned ? 'abandoned' : c.status)}{c.assigned_agent_name ? ` · ${c.assigned_agent_name}` : ''}</small></span>
      <span className="sccQueueNumbers"><b>{c.public_id || ''}</b><small>{c.duration_seconds != null ? formatDuration(c.duration_seconds) : timeAgo(c.created_at)}</small></span>
    </button>) : <div className="sccEmpty">No calls in the last 24 hours.</div>}</div> : null}

    {tab === 'callbacks' ? <div className="sccPanel">{snapshot.callbacks.length ? snapshot.callbacks.map((c) => <button type="button" key={c.id} className="sccQueue" onClick={() => setOpenId(c.ticket_id)}>
      <span><b>{c.customer_name || c.phone_number}</b><small>{label(c.origin)} · {label(c.status)}{c.attempts ? ` · attempt ${c.attempts}/${c.max_attempts}` : ''}{c.last_error ? ` · ${c.last_error}` : ''}</small></span>
      <span className="sccQueueNumbers"><b>{c.public_id || ''}</b><small>{c.not_before ? dueLabel(c.not_before) : timeAgo(c.requested_at)}</small></span>
    </button>) : <div className="sccEmpty">No callbacks.</div>}</div> : null}

    {tab === 'outreach' ? <SupportDriverOutreach isSupervisor={isSupervisor} onOpenTicket={setOpenId} onCall={(to, ticketId) => setDial({ to, ticketId, nonce: Date.now() })} /> : null}

    {tab === 'emergency' ? <SupportEmergencyConsole incidents={incidents.incidents} canAct={incidents.sensitive} isSupervisor={isSupervisor} meId={meId}
      agents={snapshot.agents} focusId={focusIncident} onChanged={incidents.reload} /> : null}
    {tab === 'lookup' && incidents.sensitive ? <SupportLookup onOpenTicket={setOpenId} /> : null}
    {tab === 'insights' && isSupervisor ? <SupportInsights agents={snapshot.agents} /> : null}

    {tab === 'tower' && isSupervisor ? <SupportControlTower snapshot={snapshot} onOpenTicket={setOpenId} /> : null}

    {openId ? <SupportTicketDrawer
      ticketId={openId} meId={meId} isSupervisor={isSupervisor} canSeeSensitive={incidents.sensitive} agents={snapshot.agents}
      onClose={() => setOpenId(null)} onChanged={() => void reload()}
      onCall={(to, ticketId) => { setDial({ to, ticketId, nonce: Date.now() }); setOpenId(null) }}
    /> : null}
  </section>
}

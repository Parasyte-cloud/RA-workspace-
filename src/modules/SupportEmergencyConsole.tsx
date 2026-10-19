import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, Siren } from 'lucide-react'
import {
  ackIncident, getIncidentDetail, INCIDENT_ACTIONS, INCIDENT_OUTCOMES, label, logIncident, reassignIncident, reopenIncident, resolveIncident, shortAge, timeAgo,
  type IncidentDetail, type IncidentRow, type SupportAgentPresence,
} from '../lib/supportCommandCentre'
import SupportLocationPanel from './SupportLocationPanel'

// Emergency / SOS console. Separate from tickets on purpose: resolving a ticket
// never touches an incident, and an incident is only closed here, with an outcome
// and notes. Nothing on this screen contacts emergency services; "Contacted
// emergency services" records that a person did it.

const EVENT_TEXT: Record<string, string> = {
  triggered: 'SOS received',
  assigned: 'Responder assigned',
  acknowledged: 'Acknowledged',
  escalated: 'Escalated because nobody acknowledged',
  followup_due: 'Still open, follow-up flagged',
  no_responder_available: 'No responder available, alert stays open',
  repeat_activation: 'Panic pressed again',
  note: 'Note',
  contacted_subject: 'Contacted the rider or driver',
  contacted_driver: 'Contacted the driver',
  dispatched_help: 'Dispatched help',
  contacted_emergency_services: 'Contacted emergency services (staff report)',
  resolved: 'Resolved',
  reopened: 'Reopened',
}

function describe(e: IncidentDetail['events'][number]): string {
  const d = e.detail || {}
  const bits: string[] = []
  if (typeof d.text === 'string') bits.push(d.text)
  if (typeof d.reason === 'string') bits.push(label(d.reason))
  if (typeof d.method === 'string') bits.push(d.method === 'auto' ? 'automatic' : label(d.method))
  if (typeof d.outcome === 'string') bits.push(label(d.outcome))
  if (typeof d.to_level === 'number') bits.push(`level ${d.to_level}`)
  if (typeof d.seconds_to_acknowledge === 'number') bits.push(`${shortAge(d.seconds_to_acknowledge)} after the alert`)
  return bits.join(' · ')
}

export default function SupportEmergencyConsole({ incidents, canAct, isSupervisor, meId, agents, focusId, onChanged }: {
  incidents: IncidentRow[]
  canAct: boolean
  isSupervisor: boolean
  meId: string | null
  agents: SupportAgentPresence[]
  focusId: string | null
  onChanged: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(focusId)
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [kind, setKind] = useState<string>('note')
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<string>('assisted_on_scene')
  const [notes, setNotes] = useState('')
  const [reassignTo, setReassignTo] = useState('')
  const [reassignWhy, setReassignWhy] = useState('')
  const [reopenWhy, setReopenWhy] = useState('')

  useEffect(() => { if (focusId) setSelectedId(focusId) }, [focusId])
  useEffect(() => { if (!selectedId && incidents.length) setSelectedId((incidents.find((i) => i.status !== 'resolved') ?? incidents[0]).id) }, [incidents, selectedId])

  const row = incidents.find((i) => i.id === selectedId) ?? null
  const version = row ? `${row.status}|${row.escalation_level}|${row.assigned_to}|${row.acknowledged_at}|${row.last_activation_at}|${row.resolved_at}` : ''

  const load = useCallback(async () => {
    if (!selectedId || !canAct) { setDetail(null); return }
    try { setDetail(await getIncidentDetail(selectedId)) }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to open the emergency.') }
  }, [selectedId, canAct])
  useEffect(() => { void load() }, [load, version])

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true); setNotice('')
    try { await work(); await load(); onChanged(); if (done) setNotice(done) }
    catch (e) { setNotice(e instanceof Error ? e.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  const resolved = row?.status === 'resolved'
  const mineOrLead = Boolean(row && (isSupervisor || row.assigned_to === meId))
  const responders = agents.filter((a) => a.employee_id !== row?.assigned_to)

  return <section className="sccSosGrid" aria-label="Emergency console">
    <div className="sccPanel">
      <div className="sccPanelTitle"><Siren size={17} /><strong>Emergencies</strong><small className="sccMuted">{incidents.filter((i) => i.status !== 'resolved').length} open</small></div>
      {incidents.length ? incidents.map((i) => <button type="button" key={i.id} className={`sccQueue ${i.id === selectedId ? 'sel' : ''} ${i.status !== 'resolved' && !i.acknowledged_at ? 'hot' : ''}`} onClick={() => setSelectedId(i.id)}>
        <span><b>{i.public_id}</b><small>{i.subject_type} · {label(i.status)}{i.escalation_level ? ` · level ${i.escalation_level}` : ''} · {i.assigned_name || 'no responder'}</small></span>
        <span className="sccQueueNumbers"><small>{timeAgo(i.activated_at)}</small></span>
      </button>) : <div className="sccEmpty">No emergencies. SOS alerts from the RideArrivo apps appear here and in the red banner.</div>}
    </div>

    <div className="sccPanel sccSosDetail">
      {!row ? <div className="sccEmpty">Select an emergency.</div> : <>
        <header className="sccDrawerHead">
          <div>
            <span className="sccEyebrow">{row.public_id} · {row.subject_type}</span>
            <h3>{resolved ? `Resolved: ${label(row.outcome)}` : row.acknowledged_at ? 'Being handled' : 'Needs acknowledgement'}</h3>
            <small>Pressed {timeAgo(row.activated_at)} · {row.acknowledged_at ? `acknowledged by ${row.acknowledged_name || 'staff'}` : 'not acknowledged'} · responder {row.assigned_name || 'none'}{row.escalation_level ? ` · escalation level ${row.escalation_level}` : ''}{row.duplicate_count ? ` · ${row.duplicate_count} repeat signal${row.duplicate_count === 1 ? '' : 's'}` : ''}</small>
          </div>
        </header>

        {!row.detail_visible || !canAct ? <p className="sccNotice"><ShieldAlert size={15} /> Your role can see that an emergency exists, its status and who owns it. Details, location and actions are for responders.</p> : <>
          {notice ? <div className="sccNotice" role="status">{notice}</div> : null}

          <div className="sccFacts">
            <span><small>Identity code</small><b>{row.identity_code || '-'}</b></span>
            <span><small>Booking</small><b>{row.booking_ref || '-'}</b></span>
            <span><small>Trip</small><b>{row.trip_ref || '-'}</b></span>
            <span><small>Vehicle</small><b>{row.vehicle_ref || '-'}</b></span>
          </div>

          {row.last_location ? <p className={`sccQuality ${row.location_age_seconds != null && row.location_age_seconds > row.location_fresh_seconds ? '' : 'ok'}`}>
            Position in the alert: {row.last_location.lat.toFixed(5)}, {row.last_location.lng.toFixed(5)} · {row.location_age_seconds != null && row.location_age_seconds <= row.location_fresh_seconds ? 'fresh' : 'LAST KNOWN'}, {shortAge(row.location_age_seconds)} old. Open a location session below for the current position.
          </p> : <p className="sccQuality">The alert carried no usable position.</p>}

          {!resolved ? <div className="sccDrawerBar">
            {!row.acknowledged_at ? <button type="button" className="sccVoicePrimary" disabled={busy} onClick={() => void act(() => ackIncident(row.id), 'Acknowledged. The incident stays open until it is resolved.')}>Acknowledge</button> : null}
          </div> : null}

          <SupportLocationPanel incidentId={row.id} meId={meId} />

          <section className="sccTimeline" aria-label="Incident timeline">
            {detail?.events.length ? detail.events.map((e) => <article key={e.id} className="sccEntry event">
              <header><b>{EVENT_TEXT[e.event_type] || label(e.event_type)}{describe(e) ? ` - ${describe(e)}` : ''}</b><small>{e.actor_name || 'System'} · {timeAgo(e.created_at)}</small></header>
            </article>) : <div className="sccEmpty">Loading timeline</div>}
          </section>

          {!resolved ? <>
            <form className="sccNoteForm" onSubmit={(ev) => { ev.preventDefault(); void act(() => logIncident(row.id, kind, text).then(() => setText('')), 'Recorded.') }}>
              <strong>Record what you did</strong>
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Action">{INCIDENT_ACTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="What happened, who you spoke to, any reference number" />
              {kind === 'contacted_emergency_services' ? <small className="sccMuted">This records that you contacted them. This system does not contact emergency services for you.</small> : null}
              <button type="submit" disabled={busy || !text.trim()}>Record</button>
            </form>

            {mineOrLead ? <form className="sccNoteForm" onSubmit={(ev) => { ev.preventDefault(); void act(() => reassignIncident(row.id, reassignTo, reassignWhy).then(() => { setReassignTo(''); setReassignWhy('') }), 'Reassigned.') }}>
              <strong>Hand over</strong>
              <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} aria-label="Hand over to"><option value="">Choose a responder</option>{responders.map((a) => <option key={a.employee_id} value={a.employee_id}>{a.display_name} ({label(a.state)})</option>)}</select>
              <input value={reassignWhy} onChange={(e) => setReassignWhy(e.target.value)} placeholder="Reason" maxLength={300} aria-label="Reason" />
              <button type="submit" disabled={busy || !reassignTo || reassignWhy.trim().length < 5}>Hand over</button>
            </form> : null}

            {mineOrLead && row.acknowledged_at ? <form className="sccNoteForm" onSubmit={(ev) => { ev.preventDefault(); void act(() => resolveIncident(row.id, outcome, notes), 'Resolved.') }}>
              <strong>Resolve</strong>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">{INCIDENT_OUTCOMES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} placeholder="Closure notes: what happened and how it ended (at least 10 characters)" />
              <button type="submit" disabled={busy || notes.trim().length < 10}>Resolve emergency</button>
            </form> : null}
          </> : isSupervisor ? <form className="sccNoteForm" onSubmit={(ev) => { ev.preventDefault(); void act(() => reopenIncident(row.id, reopenWhy).then(() => setReopenWhy('')), 'Reopened.') }}>
            <strong>Reopen</strong>
            <input value={reopenWhy} onChange={(e) => setReopenWhy(e.target.value)} placeholder="Why is this open again (at least 10 characters)" maxLength={500} aria-label="Reason" />
            <button type="submit" disabled={busy || reopenWhy.trim().length < 10}>Reopen</button>
          </form> : null}
        </>}
      </>}
    </div>
  </section>
}

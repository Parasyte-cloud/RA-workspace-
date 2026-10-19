import { useEffect, useState } from 'react'
import { Siren, WifiOff } from 'lucide-react'
import { ackIncident, shortAge, type IncidentRow } from '../lib/supportCommandCentre'

// Persistent. It is drawn from the database rows, not from a pop-up event, so it
// is still there after a reload or a reconnect, and it stays until the incident is
// resolved. Acknowledging stops the "nobody has seen this" clock; it does not remove the alert.
export default function SupportEmergencyBanner({ open, canAct, disconnected, onOpen, onChanged }: {
  open: IncidentRow[]
  canAct: boolean
  disconnected: boolean
  onOpen: (id: string) => void
  onChanged: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const waiting = open.filter((i) => !i.acknowledged_at).length
  useEffect(() => {
    const original = document.title.replace(/^\(SOS[^)]*\)\s*/, '')
    document.title = waiting ? `(SOS ${waiting}) ${original}` : original
    return () => { document.title = original }
  }, [waiting])

  const ack = async (id: string) => {
    setBusy(id); setError('')
    try { await ackIncident(id); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not acknowledge.') }
    finally { setBusy('') }
  }

  if (!open.length && !disconnected) return null
  return <div className="sccSos" role="alert" aria-live="assertive">
    {disconnected ? <div className="sccSosRow warn"><WifiOff size={16} /><span><b>Emergency feed disconnected.</b> New SOS alerts may not appear. Check your connection; this banner clears when it reconnects.</span></div> : null}
    {open.map((i) => <div key={i.id} className={`sccSosRow ${i.acknowledged_at ? 'seen' : 'new'}`}>
      <Siren size={18} />
      <span>
        <b>{i.public_id}</b> · {i.subject_type} {i.identity_code ? `· ${i.identity_code}` : ''} · {i.acknowledged_at ? `acknowledged by ${i.acknowledged_name || 'staff'}` : 'NOT ACKNOWLEDGED'}
        <small>{shortAge((now - Date.parse(i.activated_at)) / 1000)} since the button was pressed{i.escalation_level ? ` · escalation level ${i.escalation_level}` : ''} · responder {i.assigned_name || 'none yet'}</small>
      </span>
      {canAct && !i.acknowledged_at ? <button type="button" className="sccSosAck" disabled={busy === i.id} onClick={() => void ack(i.id)}>Acknowledge</button> : null}
      <button type="button" onClick={() => onOpen(i.id)}>Open</button>
    </div>)}
    {error ? <div className="sccSosRow warn"><span>{error}</span></div> : null}
  </div>
}

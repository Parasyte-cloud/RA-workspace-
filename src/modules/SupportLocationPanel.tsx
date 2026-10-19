import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, MapPin, ShieldAlert } from 'lucide-react'
import SupportMap from './SupportMap'
import {
  endLocation, fetchLocation, findMyLocationSession, getLocationSession, requestLocation, shortAge,
  type LocationReading, type LocationSession,
} from '../lib/supportCommandCentre'

// A location is shown only inside an open, audited session tied to a case or an
// emergency. The identity code alone never shows anyone's position. The panel
// says plainly whether a position is live or last known, and never dresses an
// old one as current.
const REFRESH_MS = 8000

const STATE_TEXT: Record<LocationReading['state'], string> = {
  live: 'LIVE', stale: 'LAST KNOWN', unavailable: 'NOT AVAILABLE', not_configured: 'NOT CONNECTED',
}

export default function SupportLocationPanel({ ticketId, incidentId, meId, defaultCode, minutes }: {
  ticketId?: string
  incidentId?: string
  meId: string | null
  defaultCode?: string | null
  minutes?: number
}) {
  const [session, setSession] = useState<LocationSession | null>(null)
  const [reading, setReading] = useState<LocationReading | null>(null)
  const [reason, setReason] = useState('')
  const [code, setCode] = useState(defaultCode || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  // Pick up a session opened earlier (page reload, drawer closed and reopened).
  useEffect(() => {
    setSession(null); setReading(null); setError('')
    if (!meId) return
    void findMyLocationSession({ ticketId, incidentId }, meId).then((s) => { if (alive.current && s) setSession(s) })
  }, [ticketId, incidentId, meId])

  const sid = session?.id
  const status = session?.status

  const poll = useCallback(async () => {
    if (!sid) return
    try {
      const r = await fetchLocation(sid)
      if (alive.current) { setReading(r); setError('') }
    } catch (e) {
      if (!alive.current) return
      setError(e instanceof Error ? e.message : 'Could not read the location.')
      const fresh = await getLocationSession(sid)
      if (alive.current && fresh && fresh.status !== 'active') setSession(fresh)
    }
  }, [sid])

  useEffect(() => {
    if (!sid || status !== 'active') return
    void poll()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void poll() }, REFRESH_MS)
    return () => clearInterval(t)
  }, [sid, status, poll])

  // Waiting for a supervisor: check every few seconds.
  useEffect(() => {
    if (!sid || status !== 'pending_approval') return
    const t = setInterval(async () => {
      const s = await getLocationSession(sid)
      if (alive.current && s) setSession(s)
    }, 4000)
    return () => clearInterval(t)
  }, [sid, status])

  const open = async () => {
    setBusy(true); setError('')
    try { setSession(await requestLocation({ ticketId, incidentId, identityCode: code.trim() || undefined, reason: reason.trim() })); setReading(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open a location session.') }
    finally { setBusy(false) }
  }

  const close = async () => {
    if (!sid) return
    setBusy(true)
    try { await endLocation(sid); setSession(null); setReading(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not end the session.') }
    finally { setBusy(false) }
  }

  const left = session ? Math.max(0, Math.round((Date.parse(session.expires_at) - now) / 1000)) : 0
  const live = session && (session.status === 'active' || session.status === 'pending_approval') && left > 0
  const loc = reading?.location

  return <section className="sccLoc" aria-label="Location">
    <strong><MapPin size={14} /> Location</strong>
    {!live ? <>
      <p className="sccMuted">Opens a short, logged session for this {incidentId ? 'emergency' : 'case'}. Your name, the reason and every view are recorded.</p>
      {session && session.status !== 'active' && session.status !== 'pending_approval' ? <p className="sccMuted">Last session {session.status === 'expired' ? 'expired' : session.status}.</p> : null}
      {ticketId ? <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Identity code (RAR-XXXXX-XXXXX or RAD-...)" aria-label="Identity code" maxLength={20} /> : null}
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder={incidentId ? 'Why you need the position (for example: panic pressed, checking where they are)' : 'Why you need the position (at least 10 characters)'} aria-label="Reason" />
      <button type="button" disabled={busy || reason.trim().length < 10 || (Boolean(ticketId) && !code.trim())} onClick={() => void open()}><ShieldAlert size={14} /> Open location session{minutes ? ` (${minutes} min)` : ''}</button>
    </> : session?.status === 'pending_approval' ? <p className="sccNotice">Waiting for a supervisor to approve. Nothing is shown until they do.</p> : <>
      <div className="sccLocHead">
        <span className={`sccLocBadge ${reading?.state || 'unavailable'}`}>{reading ? STATE_TEXT[reading.state] : 'LOADING'}</span>
        <small>{reading?.ageSeconds != null ? `${shortAge(reading.ageSeconds)} old` : ''} · session ends in {shortAge(left)}</small>
      </div>
      {reading?.warning ? <p className="sccQuality">{reading.warning}</p> : null}
      {loc ? <div className="sccLocBody">
        <b>{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</b>
        <small>{loc.accuracy_m != null ? `accuracy ${Math.round(loc.accuracy_m)} m` : ''}{loc.heading != null ? ` · heading ${Math.round(loc.heading)}°` : ''}{loc.speed_kmh != null ? ` · ${Math.round(loc.speed_kmh)} km/h` : ''}{reading?.source === 'sos_event' ? ' · from the SOS alert' : ''}</small>
        {reading ? <SupportMap reading={reading} /> : null}
        <a className="sccLinkBtn" href={`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=16/${loc.lat}/${loc.lng}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open in an outside map</a>
        <small className="sccMuted">Optional. Opens OpenStreetMap in a new tab and shares these coordinates with it.</small>
      </div> : null}
      {reading?.trip ? <div className="sccRelated">
        <span>Trip {reading.trip.status ? `· ${reading.trip.status}` : ''}{reading.trip.booking_ref ? ` · ${reading.trip.booking_ref}` : ''}{reading.trip.eta_minutes != null ? ` · ETA ${reading.trip.eta_minutes} min` : ''}</span>
        {reading.trip.pickup ? <span>Pickup: {reading.trip.pickup.label || `${reading.trip.pickup.lat.toFixed(4)}, ${reading.trip.pickup.lng.toFixed(4)}`}</span> : null}
        {reading.trip.dropoff ? <span>Drop-off: {reading.trip.dropoff.label || `${reading.trip.dropoff.lat.toFixed(4)}, ${reading.trip.dropoff.lng.toFixed(4)}`}</span> : null}
        {reading.trip.vehicle ? <span>Vehicle: {reading.trip.vehicle}</span> : null}
      </div> : null}
      <button type="button" disabled={busy} onClick={() => void close()}>End session</button>
    </>}
    {error ? <p className="sccNotice" role="alert">{error}</p> : null}
  </section>
}

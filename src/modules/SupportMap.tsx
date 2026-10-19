// Live map for an open location session: tiles, position with accuracy, heading, pickup and drop-off,
// the planned route, and where they have actually been. A stale position is drawn grey and dashed with a
// plain "LAST KNOWN" label, so an old fix never looks like a live one.
//
// Tiles come from OpenStreetMap by default, which is fine for light use but has no service guarantee.
// For production traffic set VITE_SUPPORT_MAP_TILE_URL (and VITE_SUPPORT_MAP_ATTRIBUTION) to a paid
// provider. Whoever serves the tiles can see which areas are viewed, never who or why.
//
// PArAsYtE | RA-Workspace support module

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed } from 'lucide-react'
import type { LocationReading } from '../lib/supportCommandCentre'

const TILE_URL = (import.meta.env.VITE_SUPPORT_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = (import.meta.env.VITE_SUPPORT_MAP_ATTRIBUTION as string | undefined) || '&copy; OpenStreetMap contributors'
const MAX_CRUMBS = 80

type Pt = [number, number]
const pin = (letter: string, color: string) => L.divIcon({
  className: 'sccPin', iconSize: [26, 26], iconAnchor: [13, 13],
  html: `<span style="background:${color}">${letter}</span>`,
})
const carIcon = (heading: number | undefined, live: boolean) => L.divIcon({
  className: 'sccCar', iconSize: [34, 34], iconAnchor: [17, 17],
  html: `<span class="${live ? 'live' : 'stale'}">${heading != null ? `<i style="transform:rotate(${Math.round(heading)}deg)"></i>` : ''}</span>`,
})

export default function SupportMap({ reading, height = 280 }: { reading: LocationReading; height?: number }) {
  const host = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{ car?: L.Marker; acc?: L.Circle; route?: L.Polyline; direct?: L.Polyline; trail?: L.Polyline; pickup?: L.Marker; dropoff?: L.Marker }>({})
  const crumbs = useRef<Array<{ at: string; p: Pt }>>([])
  const moved = useRef(false)
  const fitted = useRef(false)
  const [tileProblem, setTileProblem] = useState(false)
  const loc = reading.location
  const live = reading.state === 'live'

  // Create the map once.
  useEffect(() => {
    if (!host.current) return
    const m = L.map(host.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([6.5244, 3.3792], 13)
    let errors = 0
    const tiles = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19, crossOrigin: true })
    tiles.on('tileerror', () => { errors++; if (errors >= 3) setTileProblem(true) })
    tiles.on('tileload', () => { if (errors) { errors = 0; setTileProblem(false) } })
    tiles.addTo(m)
    m.on('dragstart zoomstart', (e) => { if ((e as unknown as { originalEvent?: unknown }).originalEvent !== undefined || e.type === 'dragstart') moved.current = true })
    map.current = m
    // The panel can mount inside a drawer that is still animating; recompute the size shortly after.
    const t = setTimeout(() => m.invalidateSize(), 250)
    return () => { clearTimeout(t); m.remove(); map.current = null; layers.current = {}; crumbs.current = []; fitted.current = false; moved.current = false }
  }, [])

  // Draw / update on every reading.
  useEffect(() => {
    const m = map.current
    if (!m || !loc) return
    const L_ = layers.current
    const here: Pt = [loc.lat, loc.lng]

    // Breadcrumb of our own readings, used when the service sends no trail of its own.
    const stamp = loc.recorded_at || String(Date.now())
    const last = crumbs.current[crumbs.current.length - 1]
    if (!last || last.at !== stamp) crumbs.current = [...crumbs.current, { at: stamp, p: here }].slice(-MAX_CRUMBS)

    const color = live ? '#16a34a' : '#d97706'
    if (!L_.car) L_.car = L.marker(here, { icon: carIcon(loc.heading, live), keyboard: false }).addTo(m)
    else { L_.car.setLatLng(here); L_.car.setIcon(carIcon(loc.heading, live)) }

    const r = loc.accuracy_m != null && loc.accuracy_m > 0 ? Math.min(loc.accuracy_m, 5000) : 0
    if (r) {
      if (!L_.acc) L_.acc = L.circle(here, { radius: r, color, weight: 1, fillOpacity: 0.12, dashArray: live ? undefined : '4 4', interactive: false }).addTo(m)
      else { L_.acc.setLatLng(here); L_.acc.setRadius(r); L_.acc.setStyle({ color, dashArray: live ? undefined : '4 4' }) }
    } else if (L_.acc) { L_.acc.remove(); L_.acc = undefined }

    const trip = reading.trip
    const upsertPin = (key: 'pickup' | 'dropoff', p: { lat: number; lng: number; label?: string } | undefined, letter: string, c: string) => {
      if (!p) { L_[key]?.remove(); L_[key] = undefined; return }
      const at: Pt = [p.lat, p.lng]
      if (!L_[key]) L_[key] = L.marker(at, { icon: pin(letter, c), keyboard: false }).addTo(m)
      else L_[key]!.setLatLng(at)
      L_[key]!.unbindTooltip(); if (p.label) L_[key]!.bindTooltip(p.label)
    }
    upsertPin('pickup', trip?.pickup, 'P', '#2563eb'); upsertPin('dropoff', trip?.dropoff, 'D', '#7c3aed')

    const route = (trip?.route || []) as Pt[]
    if (route.length >= 2) {
      if (!L_.route) L_.route = L.polyline(route, { color: '#2563eb', weight: 4, opacity: 0.7, interactive: false }).addTo(m)
      else L_.route.setLatLngs(route)
      L_.direct?.remove(); L_.direct = undefined
    } else {
      L_.route?.remove(); L_.route = undefined
      // No route supplied: a straight dashed line between pickup and drop-off, honestly labelled in the legend below.
      if (trip?.pickup && trip?.dropoff) {
        const line: Pt[] = [[trip.pickup.lat, trip.pickup.lng], [trip.dropoff.lat, trip.dropoff.lng]]
        if (!L_.direct) L_.direct = L.polyline(line, { color: '#64748b', weight: 2, dashArray: '2 8', opacity: 0.8, interactive: false }).addTo(m)
        else L_.direct.setLatLngs(line)
      } else { L_.direct?.remove(); L_.direct = undefined }
    }

    const served = (reading.trail || []).map((t) => [t.lat, t.lng] as Pt)
    const path: Pt[] = served.length >= 2 ? served : crumbs.current.map((c) => c.p)
    if (path.length >= 2) {
      if (!L_.trail) L_.trail = L.polyline(path, { color, weight: 3, opacity: 0.9, interactive: false }).addTo(m)
      else { L_.trail.setLatLngs(path); L_.trail.setStyle({ color }) }
    } else if (L_.trail) { L_.trail.remove(); L_.trail = undefined }

    if (!fitted.current) {
      const pts: Pt[] = [here, ...(trip?.pickup ? [[trip.pickup.lat, trip.pickup.lng] as Pt] : []), ...(trip?.dropoff ? [[trip.dropoff.lat, trip.dropoff.lng] as Pt] : [])]
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [30, 48], paddingBottomRight: [30, 30], maxZoom: 16 })
      else m.setView(here, Math.max(m.getZoom(), 15))
      fitted.current = true
    } else if (!moved.current) {
      m.panTo(here, { animate: false })
    }
  }, [reading, loc, live])

  if (!loc) return null
  return <div className="sccMapWrap">
    <div className="sccMapBox">
      <div ref={host} className="sccMap" style={{ height }} role="img" aria-label={`Map. Position ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}, ${live ? 'live' : 'last known'}.`} />
      <span className={`sccMapBadge ${live ? 'live' : 'stale'}`}>{live ? 'LIVE' : reading.state === 'stale' ? 'LAST KNOWN' : 'POSITION'}{reading.ageSeconds != null ? ` · ${reading.ageSeconds < 90 ? `${reading.ageSeconds}s` : `${Math.round(reading.ageSeconds / 60)} min`} old` : ''}</span>
      <button type="button" className="sccMapRecenter" aria-label="Recenter on the position" onClick={() => { moved.current = false; map.current?.setView([loc.lat, loc.lng], Math.max(map.current.getZoom(), 15)) }}><LocateFixed size={15} /></button>
    </div>
    {tileProblem ? <p className="sccNotice" role="status">The map tiles could not load. The coordinates above are still correct.</p> : null}
    <small className="sccMuted">
      {reading.trip?.route?.length ? 'Blue line: planned route. ' : reading.trip?.pickup && reading.trip?.dropoff ? 'Dotted line: straight line between pickup and drop-off, not a driving route. ' : ''}
      {(reading.trail?.length || 0) >= 2 || crumbs.current.length >= 2 ? 'Solid line: where they have been. ' : ''}
      Map tiles are loaded from {(() => { try { return new URL(TILE_URL.replace('{s}', 'a')).host } catch { return 'the map provider' } })()}.
    </small>
  </div>
}

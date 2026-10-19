# Contracts with the RideArrivo app

PArAsYtE | RA-Workspace support module

Two things must come from the main app: SOS events going in, and live positions being readable. Both are server to server. Nothing here is exposed to a browser.

## 1. Signed events into the workstation

`POST https://<project>.supabase.co/functions/v1/support-sos-ingest`

Headers

| Header | Value |
|---|---|
| `x-ra-timestamp` | unix seconds when you signed |
| `x-ra-signature` | `sha256=` + hex HMAC-SHA256 of `<timestamp>.<raw body>` using `SUPPORT_SOS_SECRET` |
| `Content-Type` | `application/json` |

Sign every attempt again. A signature older than 5 minutes is refused, which stops replays.

Node example (the same on any backend):

```js
import { createHmac } from 'node:crypto'
const body = JSON.stringify(event)
const ts = Math.floor(Date.now() / 1000).toString()
const sig = 'sha256=' + createHmac('sha256', process.env.SUPPORT_SOS_SECRET).update(`${ts}.${body}`).digest('hex')
await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ra-timestamp': ts, 'x-ra-signature': sig }, body })
```

### SOS event

```json
{
  "event_id": "sos_9f3c...",
  "subject_type": "rider",
  "subject_id": "<the rider or driver uuid in RideArrivo>",
  "identity_code": "RAR-7K2M9-QX4TB",
  "trip_id": "trip_123",
  "booking_ref": "BK-2041",
  "vehicle_id": "veh_77",
  "activated_at": "2026-10-20T09:59:00Z",
  "location": { "lat": 6.5244, "lng": 3.3792, "accuracy_m": 12, "heading": 90, "recorded_at": "2026-10-20T09:58:57Z" }
}
```

Required: `event_id`, `subject_type`, `subject_id`. Everything else is optional and is dropped, not rejected, if invalid, so a bad coordinate can never block an emergency.

| Reply | Meaning | Sender should |
|---|---|---|
| 200 `{ ok, incidentRef, duplicate, responderAssigned }` | recorded | stop retrying |
| 400 | body can never succeed | log loudly, do not retry |
| 401 | signature wrong or too old | fix the clock or the secret |
| 5xx, timeout, network error | not recorded | retry with the same `event_id` |

Rules for the sender

1. Keep the event in a local outbox until you get a 200. Retry with backoff for as long as it takes.
2. Use a stable `event_id` per button press. Retrying is always safe.
3. Alert your own team if an event has been in the outbox for more than 60 seconds. We do not yet have an inbox or dead-letter table on our side.
4. Pressing the button again within 30 minutes of an unresolved incident for the same person adds to that incident rather than creating a new one.

### Issue an identity code

```json
{ "kind": "identity_code", "subject_type": "driver", "subject_id": "<uuid>" }
```

Reply `{ "ok": true, "code": "RAD-..." }`. Idempotent: the same person always gets the same code. Run this once for every existing rider and driver, then on sign-up. A first SOS also issues a code if none exists.

## 2. Live location service (read by the workstation)

Set `RA_LOCATION_API_URL` and `RA_LOCATION_API_KEY` as function secrets. For an open location session the workstation calls

`GET <RA_LOCATION_API_URL>?subject_type=rider|driver&subject_id=<uuid>` with `Authorization: Bearer <RA_LOCATION_API_KEY>`

and expects

```json
{
  "lat": 6.5244, "lng": 3.3792, "heading": 90, "speed_kmh": 34, "accuracy_m": 8,
  "recorded_at": "2026-10-20T10:00:00Z",
  "trip": {
    "status": "in_progress", "booking_ref": "BK-2041", "eta_minutes": 7,
    "pickup": { "lat": 6.45, "lng": 3.39, "label": "Ikeja" },
    "dropoff": { "lat": 6.60, "lng": 3.35, "label": "Airport" },
    "vehicle": "Toyota Corolla LND-123XY", "driver_name": "Ada"
  }
}
```

Optional, for the map. Inside `trip`, send either `route` (a list of `{lat, lng}` points, at most 400 are kept) or `route_polyline` (a Google-style encoded polyline, with `route_precision` 5 or 6, default 5). At the top level, `trail` is a list of recent `{lat, lng, recorded_at}` points (the last 100 are kept). Without them the map shows the position only.

`recorded_at` is how old the position is, and it is what decides live versus last known. Without it the screen says it cannot be treated as live. Any other field is ignored. Keep this endpoint read only, per person, and private.

If the service is down or not configured the screen says so, and for an emergency shows the last position from the SOS event, labelled with its age.

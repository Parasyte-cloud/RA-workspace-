export const allowedOrigins = new Set([
  "https://intranet.ridearrivo.com",
])

export type SupportResource =
  | "tickets"
  | "rides"
  | "liveRides"
  | "riders"
  | "drivers"
  | "onTheGo"

export const routes: Record<SupportResource, string> = {
  tickets: "/api/support/tickets",
  rides: "/api/admin/rides",
  liveRides: "/api/admin/rides/live",
  riders: "/api/admin/riders",
  drivers: "/api/admin/drivers",
  onTheGo: "/api/on-the-go",
}

export const allowedParams = new Set([
  "status",
  "search",
  "page",
  "limit",
  "id",
])
export const UPSTREAM_TIMEOUT_MS = 15_000

const INTRANET_ORIGIN = "https://intranet.ridearrivo.com"
const ROOM7_ORIGIN = "https://room7.ridearrivo.com"

export function allowedRoomAiOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin")

  if (!origin) return null

  if (
    origin === INTRANET_ORIGIN ||
    origin === ROOM7_ORIGIN ||
    /^https:\/\/[a-z0-9-]+\.ra-workspace\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(origin)
  ) {
    return origin
  }

  return null
}

export function roomAiCors(req: Request): HeadersInit {
  const origin = allowedRoomAiOrigin(req)

  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-r7-seq, x-r7-offset-ms",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  }
}

export function roomAiJson(
  req: Request,
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...roomAiCors(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

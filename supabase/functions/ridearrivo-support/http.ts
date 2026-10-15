import { allowedOrigins, UPSTREAM_TIMEOUT_MS } from "./config.ts"

export function cors(req: Request) {
  const origin = req.headers.get("origin") || ""

  return {
    "Access-Control-Allow-Origin":
      allowedOrigins.has(origin)
        ? origin
        : "https://intranet.ridearrivo.com",

    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary": "Origin",
  }
}

export function json(
  req: Request,
  body: unknown,
  status = 200,
  requestId?: string,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...cors(req),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(requestId
          ? { "X-Request-ID": requestId }
          : {}),
      },
    },
  )
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs,
  )

  try {
    return await fetch(
      url,
      {
        ...init,
        signal: controller.signal,
      },
    )
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `RideArrivo backend timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      )
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

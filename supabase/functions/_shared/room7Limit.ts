// Shared ROOM 7 passcode abuse limiter.
//
// room-guest-session, room-event-documents and room-event-engagement all
// check the same event passcode. The guest-session endpoint counted wrong
// guesses per address and room, the other two did not, so a script could use
// them as a guessing oracle and sidestep the limit (sweep finding RA-004).
//
// Every public path now goes through guardPasscodeAttempt(). The counter key
// is identical in all three, so a guess made against any endpoint counts
// against all of them.
//
// If the counter cannot be read the request is allowed: a limiter outage must
// never lock real guests out of a live event.

export const PASSCODE_FAIL_LIMIT = 15
export const PASSCODE_FAIL_WINDOW_SECONDS = 600

type Admin = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  )
}

export async function ipHash(req: Request) {
  const bytes = new TextEncoder().encode(clientIp(req))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
}

export function passcodeFailKey(ip: string, roomId: string) {
  return `fl:${ip}:${roomId}`
}

async function count(admin: Admin, key: string, increment: boolean) {
  try {
    const { data, error } = await admin.rpc("room7_rate_count", {
      p_key: key,
      p_window_seconds: PASSCODE_FAIL_WINDOW_SECONDS,
      p_increment: increment,
    })
    if (error) {
      console.warn("ROOM 7 rate limiter unavailable:", error.message)
      return 0
    }
    return Number(data) || 0
  } catch (error) {
    console.warn("ROOM 7 rate limiter failed:", error)
    return 0
  }
}

/**
 * Runs `check` (the code that validates a guest and their passcode) behind the
 * wrong-attempt limiter. `tooMany` builds the endpoint's own 429 error so each
 * function keeps its error type. A 401/403 from `check` counts as a miss.
 */
export async function guardPasscodeAttempt<T>(
  admin: Admin,
  req: Request,
  roomId: string,
  check: () => Promise<T>,
  tooMany: () => Error,
): Promise<T> {
  const key = passcodeFailKey(await ipHash(req), roomId)

  if ((await count(admin, key, false)) >= PASSCODE_FAIL_LIMIT) {
    throw tooMany()
  }

  try {
    return await check()
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 401 || status === 403) {
      await count(admin, key, true)
    }
    throw error
  }
}

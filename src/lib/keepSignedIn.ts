// "Keep me signed in", decided per device.
//
// The sign-in session lives in one of two places:
//   ticked   -> localStorage   (survives closing the browser or the phone app)
//   unticked -> sessionStorage (gone when the browser or app is closed)
// The choice itself is a small flag in localStorage. Nothing here weakens
// sign-out, account removal or server-side session limits: those still end
// the session wherever it is stored.

export const KEEP_FLAG_KEY = 'ridearrivo-keep-signed-in'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// An old install has no flag and keeps its current behaviour (stay signed in).
export function readKeepSignedIn(local: Store | null): boolean {
  try {
    return local?.getItem(KEEP_FLAG_KEY) !== '0'
  } catch {
    return true
  }
}

// Phones start ticked, shared-looking desktop browsers start unticked.
export function defaultKeepForDevice(userAgent: string, coarsePointer: boolean): boolean {
  return coarsePointer || /android|iphone|ipad|ipod|mobile/i.test(userAgent)
}

export function writeKeepSignedIn(local: Store | null, keep: boolean) {
  try {
    local?.setItem(KEEP_FLAG_KEY, keep ? '1' : '0')
  } catch {
    /* private mode: the session simply stays where it is */
  }
}

// A storage adapter for the auth client that follows the flag on every call.
export function createAuthStorage(local: Store | null, session: Store | null): Store {
  const safe = <T,>(fn: () => T, fallback: T): T => {
    try { return fn() } catch { return fallback }
  }
  const home = () => (readKeepSignedIn(local) ? local : session)
  const other = () => (readKeepSignedIn(local) ? session : local)
  return {
    getItem: key => safe(() => home()?.getItem(key) ?? other()?.getItem(key) ?? null, null),
    setItem: (key, value) => {
      safe(() => home()?.setItem(key, value), undefined)
      safe(() => other()?.removeItem(key), undefined)
    },
    removeItem: key => {
      safe(() => local?.removeItem(key), undefined)
      safe(() => session?.removeItem(key), undefined)
    },
  }
}

// Change the choice for the current session without signing out: move the
// stored session to the right place and record the flag.
export function moveSession(local: Store | null, session: Store | null, key: string, keep: boolean) {
  const from = keep ? session : local
  const to = keep ? local : session
  writeKeepSignedIn(local, keep)
  try {
    const value = from?.getItem(key) ?? null
    if (value !== null) {
      to?.setItem(key, value)
      from?.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

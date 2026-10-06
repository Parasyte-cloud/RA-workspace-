/*
 * Hand-off from global search to a module: "open this record once you
 * have loaded". Stored in sessionStorage so it survives the module
 * mounting after navigation, and announced with an event so a module that
 * is already mounted reacts too. A focus is consumed (cleared) by the
 * module that opens it, and expires after 30 seconds.
 */
export type SearchFocus = { kind: string; id: string; at: number }

const KEY = 'ra.search.focus.v1'
const EVENT = 'ra-search-focus'
const TTL_MS = 30_000

export function setSearchFocus(kind: string, id: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ kind, id, at: Date.now() }))
  } catch { /* storage unavailable: navigation still works */ }
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function peekSearchFocus(kind: string): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const focus = JSON.parse(raw) as SearchFocus
    if (focus.kind !== kind || Date.now() - focus.at > TTL_MS) return null
    return focus.id
  } catch {
    return null
  }
}

export function clearSearchFocus() {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function onSearchFocus(handler: () => void) {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

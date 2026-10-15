// Warm a lazy chunk while the browser is idle, so the click that needs it does
// not wait on a large download. Skipped on Data Saver and slow connections, and
// run at most once per loader.
type Loader = () => Promise<unknown>

const done = new WeakSet<Loader>()

export function shouldPrefetch(conn?: { saveData?: boolean; effectiveType?: string } | null): boolean {
  if (!conn) return true
  if (conn.saveData) return false
  return !/(^|-)2g$/.test(conn.effectiveType || '')
}

export function prefetchWhenIdle(loader: Loader): void {
  if (typeof window === 'undefined' || done.has(loader)) return
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (!shouldPrefetch(conn)) return
  done.add(loader)
  const run = () => { loader().catch(() => done.delete(loader)) }
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 })
  else window.setTimeout(run, 1500)
}

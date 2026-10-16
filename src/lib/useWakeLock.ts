import { useEffect } from 'react'

type Sentinel = { release: () => Promise<void>; addEventListener: (type: 'release', cb: () => void) => void }
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> }

// Keeps the screen on while `active` is true, like Meet, Teams and Zoom do on a
// phone. The browser drops the lock whenever the tab is hidden, so it is asked
// for again when the person comes back. Not supported everywhere: then nothing
// happens and the phone behaves as before.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock
    if (!api) return
    let sentinel: Sentinel | null = null
    let stopped = false

    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || sentinel) return
      try {
        const lock = await api.request('screen')
        if (stopped) { void lock.release().catch(() => undefined); return }
        sentinel = lock
        lock.addEventListener('release', () => { if (sentinel === lock) sentinel = null })
      } catch {
        // Refused (low battery, no permission). Not worth bothering anyone.
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      const held = sentinel
      sentinel = null
      if (held) void held.release().catch(() => undefined)
    }
  }, [active])
}

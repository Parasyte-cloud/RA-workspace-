import { useEffect } from 'react'

type Sentinel = {
  release: () => Promise<void>
  addEventListener: (type: 'release', cb: () => void) => void
}

type WakeLockApi = {
  request: (type: 'screen') => Promise<Sentinel>
}

// Keeps the screen awake while a live meeting is visible. Browsers release a
// screen wake lock when a tab is hidden or the OS suspends it, so reacquire on
// every useful foreground signal instead of relying on visibilitychange alone.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock
    if (!api) return

    let sentinel: Sentinel | null = null
    let stopped = false
    let acquiring = false

    const acquire = async () => {
      if (
        stopped ||
        acquiring ||
        sentinel ||
        document.visibilityState !== 'visible'
      ) return

      acquiring = true
      try {
        const lock = await api.request('screen')
        if (stopped) {
          void lock.release().catch(() => undefined)
          return
        }
        sentinel = lock
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null
          if (!stopped && document.visibilityState === 'visible') {
            window.setTimeout(() => void acquire(), 0)
          }
        })
      } catch {
        // Low battery, permissions, or unsupported policy. The meeting still works.
      } finally {
        acquiring = false
      }
    }

    const onForeground = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('pageshow', onForeground)
    window.addEventListener('focus', onForeground)
    window.addEventListener('online', onForeground)

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('pageshow', onForeground)
      window.removeEventListener('focus', onForeground)
      window.removeEventListener('online', onForeground)
      const held = sentinel
      sentinel = null
      if (held) void held.release().catch(() => undefined)
    }
  }, [active])
}

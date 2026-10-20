const SUPPORT_HOST = 'support.ridearrivo.com'
const SUPPORT_WORKER = '/support-sw.js' as const
const DEFAULT_WORKER = '/sw.js' as const

export type WorkspaceServiceWorkerUrl = typeof SUPPORT_WORKER | typeof DEFAULT_WORKER

export function workspaceServiceWorkerUrl(hostname: string): WorkspaceServiceWorkerUrl {
  return hostname.trim().toLowerCase() === SUPPORT_HOST ? SUPPORT_WORKER : DEFAULT_WORKER
}

function registrationScriptPath(registration: ServiceWorkerRegistration): string | null {
  const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL
  if (!scriptUrl) return null
  try { return new URL(scriptUrl).pathname } catch { return null }
}

export async function registerWorkspaceServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

  const target = workspaceServiceWorkerUrl(window.location.hostname)
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()

    if (target === SUPPORT_WORKER) {
      // Older Support builds let App.tsx register /sw.js before the Support
      // module registered /support-sw.js at the same root scope. Remove only
      // that stale root worker, then converge on the dedicated Support worker.
      await Promise.all(
        registrations
          .filter(registration => {
            let scopePath = ''
            try { scopePath = new URL(registration.scope).pathname } catch { return false }
            return scopePath === '/' && registrationScriptPath(registration) === DEFAULT_WORKER
          })
          .map(registration => registration.unregister()),
      )
    }

    const existing = registrations.find(registration => registrationScriptPath(registration) === target)
    if (existing) return existing
    return await navigator.serviceWorker.register(target, { scope: '/' })
  } catch {
    return null
  }
}

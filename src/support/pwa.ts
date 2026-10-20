// Installable app and web push for the Support workspace.
//
// What works where (as of writing):
//   * Chrome, Edge, Firefox on desktop and Android: push works in a normal tab or an installed app.
//   * iPhone and iPad (iOS 16.4 and later): push works ONLY after "Add to Home Screen". In a plain Safari tab
//     there is no push at all, so the screen says so instead of offering a button that cannot work.
//   * Push needs HTTPS (the workspace already is) and the person's permission, asked only when they press the button.
//
// PArAsYtE | RA-Workspace support module

import { myPushDevices, pushConfig, registerPushDevice, unregisterPushDevice } from '../lib/supportCommandCentre'
import { registerWorkspaceServiceWorker } from '../pwa/registerWorkspaceServiceWorker'

export type PushState =
  | 'unsupported'        // this browser cannot do push
  | 'needs_install'      // iOS in a tab: install to the home screen first
  | 'not_configured'     // the server has no VAPID keys yet
  | 'blocked'            // the person said no in the browser; only they can undo it
  | 'off'                // can be turned on
  | 'on'                 // this device is registered

const MANIFEST_URL = '/support.webmanifest'

export const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)

// Add our manifest and icon only if the app has none, so we never fight an existing PWA setup.
export function ensureManifest(): void {
  if (typeof document === 'undefined') return
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = MANIFEST_URL; document.head.appendChild(l)
  }
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const l = document.createElement('link'); l.rel = 'apple-touch-icon'; l.href = '/support-icon-180.png'; document.head.appendChild(l)
  }
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  return registerWorkspaceServiceWorker()
}

const pushCapable = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function b64uToBytes(text: string): Uint8Array {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const bytesToB64u = (buf: ArrayBuffer | null): string => {
  if (!buf) return ''
  let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function currentPushState(): Promise<PushState> {
  if (!pushCapable()) return isIos() && !isStandalone() ? 'needs_install' : 'unsupported'
  if (isIos() && !isStandalone()) return 'needs_install'
  if (Notification.permission === 'denied') return 'blocked'
  try {
    const cfg = await pushConfig()
    if (!cfg.configured || !cfg.publicKey) return 'not_configured'
  } catch { /* offline or old server: fall through and let the button explain */ }
  const reg = await registerWorkspaceServiceWorker() || await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub && Notification.permission === 'granted') return 'on'
  return 'off'
}

export async function enablePush(): Promise<void> {
  if (!pushCapable()) throw new Error('This browser cannot receive push alerts.')
  if (isIos() && !isStandalone()) throw new Error('On iPhone and iPad, add the workspace to your Home Screen first, then open it from there.')
  const cfg = await pushConfig()
  if (!cfg.configured || !cfg.publicKey) throw new Error('Push alerts are not switched on for this workspace yet. Ask your administrator.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in the browser settings, then try again.')
  const reg = (await registerWorkspaceServiceWorker()) || (await navigator.serviceWorker.ready)
  const existing = await reg.pushManager.getSubscription()
  const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(cfg.publicKey) as unknown as BufferSource })
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh || bytesToB64u(sub.getKey('p256dh'))
  const auth = json.keys?.auth || bytesToB64u(sub.getKey('auth'))
  await registerPushDevice({ endpoint: sub.endpoint, p256dh, auth }, navigator.userAgent.slice(0, 250))
}

export async function disablePush(): Promise<void> {
  const reg = await registerWorkspaceServiceWorker() || await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) { await unregisterPushDevice(sub.endpoint).catch(() => undefined); await sub.unsubscribe().catch(() => undefined) }
}

export { myPushDevices }

// "Install app" prompt (Chromium). Safari/iOS has no prompt; the screen explains Add to Home Screen.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((f) => f()) })
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()) })
}
export const canPromptInstall = () => deferred !== null
export function onInstallChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const choice = await deferred.userChoice
  deferred = null; listeners.forEach((f) => f())
  return choice.outcome === 'accepted'
}

// The service worker tells open tabs where a tapped notification wanted to go.
export function onWorkerOpen(fn: (target: { tab: string | null; entityType: string | null; entityId: string | null }) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined
  const h = (e: MessageEvent) => { if (e.data?.type === 'support-open') fn({ tab: e.data.tab ?? null, entityType: e.data.entityType ?? null, entityId: e.data.entityId ?? null }) }
  navigator.serviceWorker.addEventListener('message', h)
  return () => navigator.serviceWorker.removeEventListener('message', h)
}

// Browser side of phone alerts: subscribe, unsubscribe, and ask what state we are in.

export type PushSupport = 'ready' | 'unsupported' | 'needs-install' | 'blocked' | 'not-configured'

// The browser wants the public key as bytes, not base64 text.
export function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function bufferToBase64Url(buffer: ArrayBuffer | null) {
  if (!buffer) return ''
  let text = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// iPhone only allows push for an app added to the Home Screen.
export function isIos(ua: string, platform: string, touchPoints: number) {
  return /iphone|ipad|ipod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
}

export function pushSupport(env: {
  hasWorker: boolean
  hasPush: boolean
  hasNotification: boolean
  ios: boolean
  standalone: boolean
  permission: string
  key: string
}): PushSupport {
  if (!env.key) return 'not-configured'
  if (env.ios && !env.standalone) return 'needs-install'
  if (!env.hasWorker || !env.hasPush || !env.hasNotification) return 'unsupported'
  if (env.permission === 'denied') return 'blocked'
  return 'ready'
}

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '') as string

export function currentSupport(): PushSupport {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return pushSupport({
    hasWorker: 'serviceWorker' in navigator,
    hasPush: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    ios: isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    standalone,
    permission: 'Notification' in window ? Notification.permission : 'default',
    key: VAPID_PUBLIC_KEY,
  })
}

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// Returns the subscription to store. The permission prompt is shown here, so
// call it only from a tap.
export async function subscribeToPush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were not allowed on this device.')
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))
  return {
    endpoint: subscription.endpoint,
    p256dh: bufferToBase64Url(subscription.getKey('p256dh')),
    auth: bufferToBase64Url(subscription.getKey('auth')),
  }
}

export async function unsubscribeFromPush() {
  const subscription = await currentSubscription()
  if (!subscription) return ''
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}

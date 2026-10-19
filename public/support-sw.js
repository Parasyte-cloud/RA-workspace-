/* PArAsYtE | RA-Workspace support module
 * Service worker for the Support workspace: shows push alerts and opens the right screen when tapped.
 * It deliberately caches nothing from the app, so a deploy is never stuck behind an old copy.
 * Only a small offline page is kept, shown if the network is down when the app is opened.
 */
const OFFLINE_CACHE = 'support-offline-v1'
const OFFLINE_URL = '/support-offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add(OFFLINE_URL)).catch(() => undefined).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('support-offline-') && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode !== 'navigate') return                       // everything else goes straight to the network
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())))
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { title: 'RideArrivo Support', body: event.data ? event.data.text() : '' } }
  const critical = data.severity === 'critical'
  const title = String(data.title || 'RideArrivo Support').slice(0, 120)
  const options = {
    body: String(data.body || '').slice(0, 300),
    tag: data.tag || undefined,                              // a repeat of the same alert replaces, not stacks
    renotify: Boolean(data.tag),
    requireInteraction: critical || Boolean(data.requireInteraction),
    vibrate: critical ? [300, 120, 300, 120, 600] : [120],
    icon: '/support-icon-192.png',
    badge: '/support-badge-96.png',
    data: { tab: data.tab || null, entityType: data.entityType || null, entityId: data.entityId || null },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const d = event.notification.data || {}
  const target = { type: 'support-open', tab: d.tab, entityType: d.entityType, entityId: d.entityId }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find((c) => new URL(c.url).origin === self.location.origin)
    if (open) {
      await open.focus()
      open.postMessage(target)
      return
    }
    const q = d.tab ? '?support_open=' + encodeURIComponent(d.tab) : ''
    await self.clients.openWindow('/' + q)
  })())
})

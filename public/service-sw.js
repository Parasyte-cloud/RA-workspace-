// Service worker for the customer service sites (bookings, membership, move,
// easybook, boat, air). It is separate from the workspace worker (/sw.js) on
// purpose: those sites have their own customers, their own identity and no staff
// features, so they must never share the workspace's cache or push handling.
//
// Its job is small: make each site installable and show a friendly page when the
// phone is offline. It never answers a live page, sign-in call or API call from a
// cache. The network always goes first; the cache is used only if the network
// fails for a page load. Calls to the booking backend and sign-in providers are
// on other origins, which this worker does not touch at all.
//
// Bump this number when the offline page changes. A new name makes the browser
// fetch it again and delete the old cache on activate.
const CACHE = 'ra-service-shell-v1'
const OFFLINE = '/service-offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Only page loads get a fallback. Scripts, styles, data and sign-in redirects
  // are left to the browser, so a failed deploy file is never replaced by a stale one.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE)) || Response.error()))
  }
})

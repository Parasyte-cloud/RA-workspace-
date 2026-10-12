// Service worker for the ROOM 7 guest site (room7.ridearrivo.com) only.
//
// Its job is small on purpose: make the site installable and show a friendly
// page when the phone is offline. It never answers a request for a live room
// from a cache: the network always goes first, and the cache is only used when
// the network fails. Calls to the ROOM 7 service live on another origin
// (Supabase), which this worker does not touch at all.
const CACHE = 'room7-shell-v1'
const OFFLINE = '/room7-offline.html'
const SHELL = [OFFLINE, '/icons/room7-192.png', '/icons/room7-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
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

  // Only page loads get a fallback. Scripts, styles and data are left to the
  // browser, so a failed deploy file is never replaced by a stale one.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE)) || Response.error()))
  }
})

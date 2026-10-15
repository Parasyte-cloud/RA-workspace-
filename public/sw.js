const CACHE = 'ra-workspace-shell-v7'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/ridearrivo-wordmark-transparent.png',
  '/ridearrivo-wordmark-workspace.png'
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

// A script, stylesheet or font that comes back as an HTML page is never right:
// it is the single-page fallback answering for a file that was missing for a
// moment during a deploy. Browsers keep hashed files for a year, so one bad
// answer can leave a white page until the cache is cleared by hand.
function isAssetPath(pathname) {
  return pathname.startsWith('/assets/') || /\.(?:js|mjs|css|woff2?|ttf)$/.test(pathname)
}
function isWrongType(url, response) {
  const type = (response.headers.get('content-type') || '').toLowerCase()
  return isAssetPath(url.pathname) && type.includes('text/html')
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Network-first prevents stale authenticated UI after a deployment.
  event.respondWith((async () => {
    try {
      let response = await fetch(request)
      if (isWrongType(url, response)) {
        // Ask again with a throwaway query string. That skips the browser cache
        // and Cloudflare's edge cache, either of which may be holding the bad copy.
        const retry = new URL(url.href)
        retry.searchParams.set('_r', Date.now().toString(36))
        response = await fetch(retry.href, { cache: 'reload', credentials: 'same-origin' })
        if (isWrongType(url, response)) return Response.error()
      }
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {})
      }
      return response
    } catch (_) {
      const cached = await caches.match(request)
      if (cached && !isWrongType(url, cached)) return cached
      if (request.mode === 'navigate') return caches.match('/index.html')
      return Response.error()
    }
  })())
})

// Phone alerts. The server sends a small JSON message (see
// supabase/functions/_shared/pushPayload.ts). A ring is shown as a notification
// that stays on screen until it is tapped or its 45 seconds run out; a later
// notification with the same tag (the missed call) replaces it.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = {} }

  event.waitUntil((async () => {
    // If the workspace is open and in front, the app already rings or shows the
    // notification itself. Showing a second one would double up.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // (iPhone is the exception: Safari expects every push to show something
    // and may switch push off for a site that keeps showing nothing.)
    const iphone = /iphone|ipad|ipod/i.test(self.navigator.userAgent || '')
    if (!iphone && windows.some(client => client.visibilityState === 'visible')) return

    // Little count on the app icon, like other apps (where the device supports it).
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge() } catch (_) {}

    await self.registration.showNotification(data.title || 'RideArrivo', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      silent: false,
      timestamp: Date.now(),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      requireInteraction: Boolean(data.urgent),
      vibrate: data.urgent ? [400, 200, 400, 200, 400] : undefined,
      data: { url: data.url || '/' }
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  try { if (self.navigator.clearAppBadge) self.navigator.clearAppBadge() } catch (_) {}
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(target).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})

const CACHE = 'ra-workspace-shell-v9'
const ASSETS = 'ra-workspace-assets-v1'
const ASSET_LIMIT = 400
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
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== ASSETS).map(key => caches.delete(key))))
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

  // Files under /assets/ have a content hash in their name, so a name never
  // changes meaning. Answer from the device when it is there (instant) and
  // fetch only on a miss. The page itself (index.html) stays network-first
  // below, so a deploy still shows up on the next visit.
  if (url.pathname.startsWith('/assets/') && !url.searchParams.has('_r')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS)
      const hit = await cache.match(request)
      if (hit && !isWrongType(url, hit)) return hit
      let response
      try { response = await fetch(request) } catch (_) { return Response.error() }
      if (isWrongType(url, response)) {
        const retry = new URL(url.href)
        retry.searchParams.set('_r', Date.now().toString(36))
        response = await fetch(retry.href, { cache: 'reload', credentials: 'same-origin' })
        if (isWrongType(url, response)) return Response.error()
      }
      if (response.ok) {
        cache.put(request, response.clone()).then(async () => {
          const keys = await cache.keys()
          // Oldest first: drop old builds' files once the cache grows large.
          for (const key of keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT))) await cache.delete(key)
        }).catch(() => {})
      }
      return response
    })())
    return
  }

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
    // (The server sends the unread count; without it the icon just shows a dot.)
    try {
      if (self.navigator.setAppBadge) {
        await (Number(data.badge) > 0 ? self.navigator.setAppBadge(Number(data.badge)) : self.navigator.setAppBadge())
      }
    } catch (_) {}

    // Several messages in one chat (or mailbox) before anyone looks: keep ONE
    // notification and count them, instead of each message replacing the last
    // and hiding what came before.
    let count = 1
    const groupable = data.type === 'chat_message' || data.type === 'chat_mention' || data.type === 'mail_message'
    if (groupable && data.tag && !data.repeat) {
      try {
        const shown = await self.registration.getNotifications({ tag: data.tag })
        if (shown.length) count = Math.min(99, ((shown[0].data && shown[0].data.count) || 1) + 1)
      } catch (_) {}
    }
    const noun = data.type === 'mail_message' ? 'new emails' : 'new messages'
    const body = count > 1 ? `${count} ${noun}. Latest: ${data.body || ''}`.trim() : (data.body || '')

    await self.registration.showNotification(data.title || 'RideArrivo', {
      body,
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      silent: false,
      timestamp: Date.now(),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      requireInteraction: Boolean(data.urgent),
      // A ring buzzes long. A chat message gives two short buzzes, like WhatsApp.
      vibrate: data.urgent ? [400, 200, 400, 200, 400] : (data.type === 'chat_message' || data.type === 'chat_mention' || data.type === 'room_join_request') ? [180, 90, 180] : undefined,
      data: { url: data.url || '/', count }
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  // The icon count is the app's to set (it knows the real unread total), so a tap does not wipe it.
  // Only ever open pages on our own origin, whatever the payload says.
  let target = new URL('/', self.location.origin).href
  try {
    const wanted = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
    if (wanted.origin === self.location.origin) target = wanted.href
  } catch (_) {}

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus()
        // Ask the open app to go there itself. Reloading the page with
        // navigate() would drop what the person is doing, even a live call.
        // If the app does not answer (an older copy), fall back to navigate().
        const handled = await new Promise(resolve => {
          try {
            const channel = new MessageChannel()
            const timer = setTimeout(() => resolve(false), 700)
            channel.port1.onmessage = reply => { clearTimeout(timer); resolve(Boolean(reply.data && reply.data.handled)) }
            client.postMessage({ type: 'ra-open', url: target }, [channel.port2])
          } catch (_) { resolve(false) }
        })
        if (!handled && 'navigate' in client) await client.navigate(target).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})

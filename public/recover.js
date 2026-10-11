// Self-repair for a white page. Loaded before the app. If the app's own script
// fails to load (for example a bad copy held by a cache after a deploy), try it
// once more under a throwaway query string, which skips every cache. If that
// also fails, clear this site's caches and service worker and reload once.
// Each step runs at most once per tab session, so it can never loop.
(function () {
  var RETRY = 'ra-recover-retry'
  var CLEAR = 'ra-recover-clear'
  function once(key) {
    try {
      if (sessionStorage.getItem(key)) return false
      sessionStorage.setItem(key, '1')
      return true
    } catch (_) { return false }
  }
  function clearAndReload() {
    var work = []
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      work.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.unregister() }))
      }))
    }
    if (window.caches && caches.keys) {
      work.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k) }))
      }))
    }
    Promise.all(work).catch(function () {}).then(function () { location.reload() })
  }
  window.addEventListener('error', function (event) {
    var el = event && event.target
    if (!el || el.tagName !== 'SCRIPT' || !el.src) return
    var url
    try { url = new URL(el.src) } catch (_) { return }
    if (url.origin !== location.origin) return
    if (url.searchParams.has('_r')) {
      // The throwaway retry failed too: last resort.
      if (once(CLEAR)) clearAndReload()
      return
    }
    if (!once(RETRY)) return
    url.searchParams.set('_r', Date.now().toString(36))
    var again = document.createElement('script')
    again.type = el.type || 'module'
    again.crossOrigin = 'anonymous'
    again.src = url.href
    document.head.appendChild(again)
  }, true)
})()

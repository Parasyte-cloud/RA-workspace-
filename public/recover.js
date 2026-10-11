// Self-repair for a white page. Loaded before the app. If the app's own script
// fails to load (for example a bad cached copy after a deploy), clear the
// workspace's caches and the service worker once, fetch the script fresh, and
// reload. Runs at most once per tab session so it can never loop.
(function () {
  var KEY = 'ra-recover-once'
  window.addEventListener('error', function (event) {
    var el = event && event.target
    if (!el || el.tagName !== 'SCRIPT' || !el.src) return
    try {
      if (new URL(el.src).origin !== location.origin) return
      if (sessionStorage.getItem(KEY)) return
      sessionStorage.setItem(KEY, '1')
    } catch (_) { return }
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
    work.push(fetch(el.src, { cache: 'reload' }).catch(function () {}))
    Promise.all(work).catch(function () {}).then(function () { location.reload() })
  }, true)
})()

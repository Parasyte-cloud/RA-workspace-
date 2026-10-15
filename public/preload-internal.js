// Starts downloading the intranet app while the entry script is still loading.
// Only on the workspace hosts: the public forms and ROOM 7 pages do not use it.
// The list comes from a <meta name="ra-preload"> written at build time.
(function () {
  var host = location.hostname.toLowerCase()
  var intranet = host === 'intranet.ridearrivo.com' || /^(localhost|127\.0\.0\.1)$/.test(host)
  if (!intranet || /[?&]surface=/.test(location.search)) return
  var meta = document.querySelector('meta[name="ra-preload"]')
  if (!meta) return
  function add(rel, href, extra) {
    if (!href) return
    var link = document.createElement('link')
    link.rel = rel
    link.href = href
    if (rel === 'modulepreload') link.crossOrigin = ''
    if (extra) link.as = extra
    document.head.appendChild(link)
  }
  ;(meta.getAttribute('content') || '').split(',').forEach(function (href) { add('modulepreload', href) })
  ;(meta.getAttribute('data-css') || '').split(',').forEach(function (href) { add('preload', href, 'style') })
})()

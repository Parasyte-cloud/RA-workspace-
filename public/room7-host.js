// ROOM 7 guest host: use the ROOM 7 manifest, icon and colours so the
// page installs as "ROOM 7" and not as the intranet. Runs before the
// browser reads the manifest.
(function () {
  var host = location.hostname.toLowerCase()
  var dev = /^(localhost|127\.0\.0\.1)$/.test(host) && /[?&]surface=room7-public/.test(location.search)
  if (host !== 'room7.ridearrivo.com' && !dev) return
  var m = document.querySelector('link[rel="manifest"]'); if (m) m.href = '/room7.webmanifest'
  var a = document.querySelector('link[rel="apple-touch-icon"]'); if (a) a.href = '/icons/room7-apple-180.png'
  var t = document.querySelector('meta[name="theme-color"]'); if (t) t.content = '#071A38'
  document.title = 'ROOM 7'
  var meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; meta.content = 'ROOM 7'
  document.head.appendChild(meta)
})()

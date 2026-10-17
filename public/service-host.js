// Customer service hosts: use that service's own manifest, title and
// colours instead of the internal Workspace identity (sweep RA-020).
// Runs before the browser reads the manifest, same idea as room7-host.js.
(function () {
  var names = {
    'bookings.ridearrivo.com': ['bookings', 'ArrivoChauffeur', 'Chauffeur'],
    'membership.ridearrivo.com': ['membership', 'RideArrivo Membership', 'Membership'],
    'move.ridearrivo.com': ['move', 'ArrivoRemovals', 'Removals'],
    'easybook.ridearrivo.com': ['easybook', 'RideArrivo Easybook', 'Easybook'],
    'boat.ridearrivo.com': ['boat', 'ArrivoBoat', 'ArrivoBoat'],
    'air.ridearrivo.com': ['air', 'ArrivoAir', 'ArrivoAir']
  }
  var hit = names[location.hostname.toLowerCase()]
  if (!hit) return
  var m = document.querySelector('link[rel="manifest"]'); if (m) m.href = '/service-' + hit[0] + '.webmanifest'
  var t = document.querySelector('meta[name="theme-color"]'); if (t) t.content = '#071A38'
  document.title = hit[1]
  // ArrivoChauffeur has its own icon, for the tab and the iPhone home screen.
  if (hit[0] === 'bookings') {
    var fav = document.querySelector('link[rel="icon"]'); if (fav) fav.href = '/icons/chauffeur-192.png'
    var apple = document.querySelector('link[rel="apple-touch-icon"]'); if (apple) apple.href = '/icons/chauffeur-apple-180.png'
  }
  // Each customer site gets its own small worker (offline page only). It is not
  // the workspace worker, so the two never share a cache or push handling.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-sw.js').catch(function () {})
  var meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; meta.content = hit[2]
  document.head.appendChild(meta)
})()

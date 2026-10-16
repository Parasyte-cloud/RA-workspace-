// Customer service hosts: use that service's own manifest, title and
// colours instead of the internal Workspace identity (sweep RA-020).
// Runs before the browser reads the manifest, same idea as room7-host.js.
(function () {
  var names = {
    'bookings.ridearrivo.com': ['bookings', 'RideArrivo Bookings', 'Bookings'],
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
  var meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; meta.content = hit[2]
  document.head.appendChild(meta)
})()

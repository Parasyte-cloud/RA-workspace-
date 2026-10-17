// Kept as a file, not inline, because the sites enforce a Content-Security-Policy
// that does not allow inline scripts.
(function () {
  var names = {
    'bookings.ridearrivo.com': 'ArrivoChauffeur',
    'membership.ridearrivo.com': 'RideArrivo Membership',
    'move.ridearrivo.com': 'ArrivoRemovals',
    'easybook.ridearrivo.com': 'RideArrivo Easybook',
    'boat.ridearrivo.com': 'ArrivoBoat',
    'air.ridearrivo.com': 'ArrivoAir'
  }
  var name = names[location.hostname.toLowerCase()]
  if (name) {
    document.title = name + ' is offline'
    document.getElementById('name').textContent = name + ' is offline'
  }
  document.getElementById('retry').addEventListener('click', function () { location.reload() })
})()

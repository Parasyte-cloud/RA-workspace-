// The RideArrivo family shown in the ROOM 7 top bar. Edit this one list to
// change the ticker and the sheet: names, one line each, and where they go.
export type Room7Product = { id: string; name: string; line: string; href: string }

export const ROOM7_PRODUCTS: Room7Product[] = [
  { id: 'ridearrivo', name: 'RideArrivo', line: 'Airport pickups and drop-offs, booked ahead.', href: 'https://www.ridearrivo.com' },
  { id: 'express', name: 'ArrivoExpress', line: 'On-demand rides around the city.', href: 'https://express.ridearrivo.com' },
  { id: 'air', name: 'ArrivoAir', line: 'Air travel and charter flights.', href: 'https://air.ridearrivo.com' },
  { id: 'boat', name: 'ArrivoBoat', line: 'Boat and water transfers.', href: 'https://boat.ridearrivo.com' },
  { id: 'removals', name: 'ArrivoRemovals', line: 'Moving and removals with a trained crew.', href: 'https://move.ridearrivo.com' },
  { id: 'chauffeur', name: 'ArrivoChauffeur', line: 'A private chauffeur for events and charters.', href: 'https://www.ridearrivo.com/charter-booking.html' },
]

// Only https links to our own domain ever reach the page.
export function safeProductHref(href: string): string | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:') return null
    if (url.hostname !== 'ridearrivo.com' && !url.hostname.endsWith('.ridearrivo.com')) return null
    return url.toString()
  } catch {
    return null
  }
}

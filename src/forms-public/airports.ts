/*
 * Curated airport list for ArrivoAir's departure / destination pickers
 * (AirApp.tsx). This is deliberately a short, hand-picked list, not a
 * full IATA database -- private jet charter only makes sense out of
 * airports that actually handle general aviation / FBOs, so a giant
 * autocomplete of every commercial airstrip would mostly add noise.
 *
 * Nigerian entries cover every state capital or major city ArrivoBoat's
 * counterpart, ArrivoAir, would realistically be asked to fly out of.
 * The international entries are the hubs a Lagos-based private jet
 * client actually asks about -- regional West/East/Southern Africa,
 * the Gulf, and the classic private-aviation gateways into Europe and
 * the US (Farnborough/Luton over Heathrow, Le Bourget over Charles de
 * Gaulle, Teterboro over JFK -- that's genuinely where jets go).
 *
 * The picker (AirportField in AirApp.tsx) still accepts free text, so
 * a route this list doesn't cover is never blocked -- it just won't
 * autocomplete.
 */

export type Airport = {
  code: string
  city: string
  name: string
  country: string
}

export const AIRPORTS: Airport[] = [
  // Nigeria
  { code: 'LOS', city: 'Lagos', name: 'Murtala Muhammed International', country: 'Nigeria' },
  { code: 'ABV', city: 'Abuja', name: 'Nnamdi Azikiwe International', country: 'Nigeria' },
  { code: 'PHC', city: 'Port Harcourt', name: 'Port Harcourt International', country: 'Nigeria' },
  { code: 'KAN', city: 'Kano', name: 'Mallam Aminu Kano International', country: 'Nigeria' },
  { code: 'ENU', city: 'Enugu', name: 'Akanu Ibiam International', country: 'Nigeria' },
  { code: 'CBQ', city: 'Calabar', name: 'Margaret Ekpo International', country: 'Nigeria' },
  { code: 'QOW', city: 'Sokoto', name: 'Sadiq Abubakar III International', country: 'Nigeria' },
  { code: 'KAD', city: 'Kaduna', name: 'Kaduna International', country: 'Nigeria' },
  { code: 'ILR', city: 'Ilorin', name: 'Ilorin International', country: 'Nigeria' },
  { code: 'YOL', city: 'Yola', name: 'Yola Airport', country: 'Nigeria' },
  { code: 'MIU', city: 'Maiduguri', name: 'Maiduguri International', country: 'Nigeria' },
  { code: 'JOS', city: 'Jos', name: 'Yakubu Gowon Airport', country: 'Nigeria' },
  { code: 'QUO', city: 'Akwa Ibom', name: 'Victor Attah International', country: 'Nigeria' },
  { code: 'AKR', city: 'Akure', name: 'Akure Airport', country: 'Nigeria' },
  { code: 'BNI', city: 'Benin City', name: 'Benin Airport', country: 'Nigeria' },
  { code: 'QRW', city: 'Warri', name: 'Osubi Airstrip', country: 'Nigeria' },
  { code: 'ABB', city: 'Asaba', name: 'Asaba International', country: 'Nigeria' },
  { code: 'MDI', city: 'Makurdi', name: 'Makurdi Airport', country: 'Nigeria' },
  { code: 'GMO', city: 'Gombe', name: 'Gombe Lawanti International', country: 'Nigeria' },
  { code: 'BCU', city: 'Bauchi', name: 'Sir Abubakar Tafawa Balewa', country: 'Nigeria' },

  // West / East / Southern Africa
  { code: 'ACC', city: 'Accra', name: 'Kotoka International', country: 'Ghana' },
  { code: 'ABJ', city: 'Abidjan', name: 'Felix-Houphouet-Boigny International', country: "Cote d'Ivoire" },
  { code: 'DKR', city: 'Dakar', name: 'Blaise Diagne International', country: 'Senegal' },
  { code: 'COO', city: 'Cotonou', name: 'Cadjehoun Airport', country: 'Benin' },
  { code: 'LFW', city: 'Lome', name: 'Lome-Tokoin International', country: 'Togo' },
  { code: 'DLA', city: 'Douala', name: 'Douala International', country: 'Cameroon' },
  { code: 'LBV', city: 'Libreville', name: "Leon M'ba International", country: 'Gabon' },
  { code: 'NBO', city: 'Nairobi', name: 'Jomo Kenyatta International', country: 'Kenya' },
  { code: 'ADD', city: 'Addis Ababa', name: 'Bole International', country: 'Ethiopia' },
  { code: 'JNB', city: 'Johannesburg', name: 'O.R. Tambo International', country: 'South Africa' },
  { code: 'CPT', city: 'Cape Town', name: 'Cape Town International', country: 'South Africa' },

  // Gulf / Middle East
  { code: 'DXB', city: 'Dubai', name: 'Dubai International', country: 'UAE' },
  { code: 'AUH', city: 'Abu Dhabi', name: 'Zayed International', country: 'UAE' },
  { code: 'DOH', city: 'Doha', name: 'Hamad International', country: 'Qatar' },

  // Europe (private-aviation gateways, not the big commercial hubs)
  { code: 'FAB', city: 'London', name: 'Farnborough Airport', country: 'United Kingdom' },
  { code: 'LTN', city: 'London', name: 'Luton Airport', country: 'United Kingdom' },
  { code: 'LBG', city: 'Paris', name: 'Paris-Le Bourget', country: 'France' },
  { code: 'GVA', city: 'Geneva', name: 'Geneva Airport', country: 'Switzerland' },
  { code: 'ZRH', city: 'Zurich', name: 'Zurich Airport', country: 'Switzerland' },
  { code: 'FCO', city: 'Rome', name: 'Leonardo da Vinci-Fiumicino', country: 'Italy' },

  // North America (private-aviation gateways)
  { code: 'TEB', city: 'New York', name: 'Teterboro Airport', country: 'United States' },
  { code: 'MIA', city: 'Miami', name: 'Miami International', country: 'United States' },
  { code: 'ATL', city: 'Atlanta', name: 'Hartsfield-Jackson International', country: 'United States' },
  { code: 'YYZ', city: 'Toronto', name: 'Toronto Pearson International', country: 'Canada' },
]

function normalize(value: string) {
  return value.trim().toLowerCase()
}

/*
 * Ranks matches: exact/prefix IATA code hits first, then city-name
 * prefix hits, then anything else that contains the query anywhere
 * (airport name, country). Keeps the dropdown short and the most
 * likely match on top instead of raw array order.
 */
export function searchAirports(query: string, limit = 7): Airport[] {
  const needle = normalize(query)
  if (!needle) return AIRPORTS.slice(0, limit)

  const scored = AIRPORTS.map(airport => {
    const code = normalize(airport.code)
    const city = normalize(airport.city)
    const name = normalize(airport.name)
    const country = normalize(airport.country)

    let score = -1
    if (code === needle) score = 100
    else if (code.startsWith(needle)) score = 90
    else if (city.startsWith(needle)) score = 80
    else if (name.startsWith(needle)) score = 60
    else if (city.includes(needle)) score = 40
    else if (name.includes(needle) || country.includes(needle)) score = 20

    return { airport, score }
  })

  return scored
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.airport)
}

export function formatAirport(airport: Airport): string {
  return `${airport.city} (${airport.code})`
}

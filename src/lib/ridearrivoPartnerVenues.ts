import { supabase } from './supabase'

export type PublishVenueInput = {
  partnerId: string
  partnerName: string
  arrivoVenueId?: number | null
  venue: {
    name: string
    category: string
    address: string
    lat?: string | number
    lng?: string | number
    perkDescription?: string
  }
}

export type PublishedVenue = {
  id: number
  name: string
  category: string
  address: string
  lat: number | null
  lng: number | null
  perk_description: string | null
  is_active: boolean
}

// Publishes (or updates) a partner's reserved-pickup venue on the RideArrivo
// side, so it shows up in the rider/driver apps as "<name> x RideArrivo".
// The Edge Function this calls re-checks, server-side, that the partner
// actually has a signed/active agreement on file before it will do this --
// callers only ever see the resulting success or the reason it was refused.
export async function publishPartnerVenue(
  input: PublishVenueInput
): Promise<PublishedVenue> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError || !session?.access_token) {
    throw new Error('Your RideArrivo Workspace session has expired.')
  }

  const invocation = supabase.functions.invoke('ridearrivo-partner-venues', {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: {
      action: 'publishVenue',
      partnerId: input.partnerId,
      partnerName: input.partnerName,
      arrivoVenueId: input.arrivoVenueId || undefined,
      venue: input.venue,
    },
  })

  const { data, error } = await invocation

  if (error) {
    let message = error.message || 'Could not publish this venue to RideArrivo.'

    try {
      const context = (error as any).context
      if (context && typeof context.json === 'function') {
        const responseBody = await context.json()
        message = responseBody?.error || responseBody?.message || message
      }
    } catch {
      // Preserve the original Supabase error.
    }

    throw new Error(message)
  }

  if (data?.error) {
    throw new Error(String(data.error))
  }

  return data.venue as PublishedVenue
}

import { supabase } from './supabase'

export type SupportResource =
  | 'tickets'
  | 'rides'
  | 'liveRides'
  | 'riders'
  | 'drivers'
  | 'onTheGo'

export async function getRideArrivoSupportData(
  resource: SupportResource,
  params: Record<string, string | number | undefined> = {}
) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.functions.invoke(
    'ridearrivo-support',
    {
      body: {
        resource,
        params,
      },
    }
  )

  if (error) {
    let message = error.message || 'Unable to load RideArrivo support data.'

    try {
      const context = (error as any).context

      if (context && typeof context.json === 'function') {
        const body = await context.json()

        if (body?.error) {
          message = body.error
        } else if (body?.message) {
          message = body.message
        } else {
          message = JSON.stringify(body)
        }
      }
    } catch {
      // Keep original Supabase error message.
    }

    throw new Error(message)
  }

  if (data?.error) {
    throw new Error(data.error)
  }

  return data
}

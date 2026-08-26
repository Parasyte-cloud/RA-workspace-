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
    throw new Error(error.message || 'Unable to load RideArrivo support data.')
  }

  if (data?.error) {
    throw new Error(data.error)
  }

  return data
}

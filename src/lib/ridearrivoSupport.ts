import { supabase } from './supabase'

export type SupportResource =
  | 'tickets'
  | 'rides'
  | 'liveRides'
  | 'riders'
  | 'drivers'
  | 'onTheGo'

export async function getRideArrivoSupportData(
  resource:SupportResource,
  params:Record<
    string,
    string|number|undefined
  >={}
){
  if(!supabase){
    throw new Error(
      'Supabase is not configured.'
    )
  }

  const {
    data:{session},
    error:sessionError
  }=
    await supabase.auth.getSession()

  if(
    sessionError ||
    !session?.access_token
  ){
    throw new Error(
      'Your RideArrivo Workspace session has expired.'
    )
  }

  const {
    data,
    error
  }=
    await supabase.functions.invoke(
      'ridearrivo-support',
      {
        headers:{
          Authorization:
            `Bearer ${session.access_token}`
        },

        body:{
          resource,
          params
        }
      }
    )

  if(error){
    let message=
      error.message ||
      'Unable to load RideArrivo Support data.'

    try{
      const context=
        (error as any).context

      if(
        context &&
        typeof context.json==='function'
      ){
        const responseBody=
          await context.json()

        message=
          responseBody?.error ||
          responseBody?.message ||
          message
      }
    }catch{
      // Preserve the original Supabase error.
    }

    throw new Error(message)
  }

  if(data?.error){
    throw new Error(
      String(data.error)
    )
  }

  return data
}

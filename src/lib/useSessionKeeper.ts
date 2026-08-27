import {
  useEffect,
} from 'react'

import type {
  Session,
  SupabaseClient,
} from '@supabase/supabase-js'

const REFRESH_WINDOW_SECONDS =
  5 * 60

const CHECK_INTERVAL_MS =
  60 * 1000

function expiresSoon(
  session:Session
){
  if(!session.expires_at){
    return false
  }

  const now =
    Math.floor(Date.now()/1000)

  return (
    session.expires_at - now
    <= REFRESH_WINDOW_SECONDS
  )
}

export function useSessionKeeper(
  client:SupabaseClient|null,
  session:Session|null,
  setSession:(
    session:Session|null
  )=>void
){
  useEffect(()=>{
    if(
      !client ||
      !session
    ){
      return
    }

    let stopped=false
    let refreshing=false

    const refreshIfNeeded=
      async(force=false)=>{
        if(
          stopped ||
          refreshing
        ){
          return
        }

        try{
          const {
            data:{
              session:current
            },
            error,
          }=
            await client.auth
              .getSession()

          if(stopped) return

          if(error){
            console.warn(
              'Session check failed',
              error.message
            )

            // Do NOT immediately log the
            // employee out because of one
            // temporary network failure.
            return
          }

          if(!current){
            return
          }

          if(
            !force &&
            !expiresSoon(current)
          ){
            if(
              current.access_token !==
              session.access_token
            ){
              setSession(current)
            }

            return
          }

          refreshing=true

          const {
            data,
            error:refreshError,
          }=
            await client.auth
              .refreshSession()

          if(stopped) return

          if(refreshError){
            console.warn(
              'Session refresh failed',
              refreshError.message
            )

            return
          }

          if(data.session){
            setSession(
              data.session
            )
          }

        }catch(error){
          console.warn(
            'Session keeper error',
            error
          )
        }finally{
          refreshing=false
        }
      }

    const timer=
      window.setInterval(
        ()=>{
          void refreshIfNeeded()
        },
        CHECK_INTERVAL_MS
      )

    const onVisibility=()=>{
      if(
        document.visibilityState===
        'visible'
      ){
        void refreshIfNeeded()
      }
    }

    const onFocus=()=>{
      void refreshIfNeeded()
    }

    const onOnline=()=>{
      void refreshIfNeeded(true)
    }

    document.addEventListener(
      'visibilitychange',
      onVisibility
    )

    window.addEventListener(
      'focus',
      onFocus
    )

    window.addEventListener(
      'online',
      onOnline
    )

    // Run immediately too.
    void refreshIfNeeded()

    return()=>{
      stopped=true

      window.clearInterval(
        timer
      )

      document.removeEventListener(
        'visibilitychange',
        onVisibility
      )

      window.removeEventListener(
        'focus',
        onFocus
      )

      window.removeEventListener(
        'online',
        onOnline
      )
    }
  },[
    client,
    session?.user?.id,
    session?.access_token,
    setSession,
  ])
}

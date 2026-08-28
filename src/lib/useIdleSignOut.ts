import { useEffect } from 'react'
import type {
  Session,
  SupabaseClient,
} from '@supabase/supabase-js'

const IDLE_LIMIT_MS =
  30 * 60 * 1000

const CHECK_INTERVAL_MS =
  30 * 1000

const ACTIVITY_KEY =
  'ridearrivo-last-activity'

const ACTIVITY_WRITE_THROTTLE_MS =
  15 * 1000

export function useIdleSignOut(
  client: SupabaseClient | null,
  session: Session | null
) {
  useEffect(() => {
    if (!client || !session) {
      return
    }

    let lastWrite = 0
    let signingOut = false

    const writeActivity = () => {
      const now = Date.now()

      if (
        now - lastWrite <
        ACTIVITY_WRITE_THROTTLE_MS
      ) {
        return
      }

      lastWrite = now

      window.localStorage.setItem(
        ACTIVITY_KEY,
        String(now)
      )
    }

    const getLastActivity = () => {
      const raw =
        window.localStorage.getItem(
          ACTIVITY_KEY
        )

      const parsed =
        raw ? Number(raw) : NaN

      if (!Number.isFinite(parsed)) {
        const now = Date.now()

        window.localStorage.setItem(
          ACTIVITY_KEY,
          String(now)
        )

        return now
      }

      return parsed
    }

    const checkIdle = async () => {
      if (signingOut) {
        return
      }

      const lastActivity =
        getLastActivity()

      const idleFor =
        Date.now() - lastActivity

      if (idleFor < IDLE_LIMIT_MS) {
        return
      }

      signingOut = true

      try {
        console.info(
          '[RideArrivo Auth]',
          'IDLE_TIMEOUT'
        )

        await client.auth.signOut()
      } catch (error) {
        console.error(
          'Idle sign-out failed',
          error
        )
      } finally {
        signingOut = false
      }
    }

    const activityEvents: Array<
      keyof WindowEventMap
    > = [
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
      'pointerdown',
    ]

    activityEvents.forEach(event => {
      window.addEventListener(
        event,
        writeActivity,
        {
          passive: true,
        }
      )
    })

    const onStorage = (
      event: StorageEvent
    ) => {
      if (
        event.key === ACTIVITY_KEY
      ) {
        lastWrite = Date.now()
      }
    }

    window.addEventListener(
      'storage',
      onStorage
    )

    const onVisibility = () => {
      if (
        document.visibilityState ===
        'visible'
      ) {
        void checkIdle()
      }
    }

    document.addEventListener(
      'visibilitychange',
      onVisibility
    )

    writeActivity()

    const timer =
      window.setInterval(
        () => {
          void checkIdle()
        },
        CHECK_INTERVAL_MS
      )

    return () => {
      window.clearInterval(timer)

      activityEvents.forEach(event => {
        window.removeEventListener(
          event,
          writeActivity
        )
      })

      window.removeEventListener(
        'storage',
        onStorage
      )

      document.removeEventListener(
        'visibilitychange',
        onVisibility
      )
    }
  }, [
    client,
    session?.user?.id,
  ])
}

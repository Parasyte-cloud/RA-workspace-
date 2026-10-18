import { useEffect } from 'react'
import type {
  Session,
  SupabaseClient,
} from '@supabase/supabase-js'
import { readKeepSignedIn } from './keepSignedIn'
import { signOutThisDevice } from './authSignOut'

const IDLE_LIMIT_MS =
  30 * 60 * 1000

const CHECK_INTERVAL_MS =
  30 * 1000

const ACTIVITY_KEY =
  'ridearrivo-last-activity'

const ACTIVITY_WRITE_THROTTLE_MS =
  15 * 1000

// Browsers can block storage (private windows, strict settings). The last
// activity time then lives in memory for this tab, so the idle check keeps
// working instead of throwing every 30 seconds.
let memoryActivity = Date.now()

function storeActivity(ms: number) {
  memoryActivity = ms
  try {
    window.localStorage.setItem(ACTIVITY_KEY, String(ms))
  } catch {
    /* memory copy is enough */
  }
}

function loadActivity(): number {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY)
    const parsed = raw ? Number(raw) : NaN
    if (Number.isFinite(parsed)) return parsed
  } catch {
    /* fall through to the memory copy */
  }
  return memoryActivity
}

// While a call or meeting is open the person is present even when they are not
// touching the keyboard, so the idle timer must not sign them out of it.
let holds = 0

export function useHoldIdleSignOut(active: boolean) {
  useEffect(() => {
    if (!active) return
    holds += 1
    storeActivity(Date.now())
    return () => {
      holds = Math.max(0, holds - 1)
      // Counts as activity at the moment the call ends, so leaving a long
      // call does not sign the person out a second later.
      storeActivity(Date.now())
    }
  }, [active])
}

export function idleHoldCount() {
  return holds
}

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
      storeActivity(now)
    }

    const getLastActivity = loadActivity

    const checkIdle = async () => {
      if (signingOut) {
        return
      }

      // "Keep me signed in" on this device means exactly that: the idle timer
      // only applies when the box is unticked (shared or borrowed computers).
      // Read live so ticking or unticking in Settings takes effect at once.
      if (readKeepSignedIn(window.localStorage)) {
        return
      }

      if (holds > 0) {
        storeActivity(Date.now())
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

        // Only this device: a timeout here must not end the phone's session.
        await signOutThisDevice(client, 'idle')
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

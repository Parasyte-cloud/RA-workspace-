import { useCallback, useRef } from 'react'

type Leavable = {
  leave: () => Promise<void>
}

/*
 * Shuts down RealtimeKit clients we no longer use.
 *
 * useRealtimeKitClient() never disposes the previous client when it is
 * initialised again. After a network drop the SDK keeps trying to recover
 * that old client on its own, while our reconnect has already fetched a new
 * token. When the old client gets through it shows up as a second, frozen
 * copy of the same person (no mic, no camera). Retiring it means: leave it,
 * and ignore any events it still emits.
 */
export function useRetiredClients() {
  const retiredRef = useRef(new WeakSet<object>())

  const retire = useCallback((client?: Leavable | null) => {
    if (!client || retiredRef.current.has(client)) {
      return
    }
    retiredRef.current.add(client)
    void client.leave().catch(() => {})
  }, [])

  const isRetired = useCallback(
    (client?: object | null) => Boolean(client && retiredRef.current.has(client)),
    [],
  )

  return { retire, isRetired }
}

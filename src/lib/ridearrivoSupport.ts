import { supabase } from './supabase'

export type SupportResource =
  | 'tickets'
  | 'rides'
  | 'liveRides'
  | 'riders'
  | 'drivers'
  | 'onTheGo'

const SUPPORT_REQUEST_TIMEOUT_MS = 20_000

const inflightSupportRequests = new Map<
  string,
  Promise<unknown>
>()

function stableParamsKey(
  params: Record<string, string | number | undefined>
) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: number | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(
            new Error(
              'RideArrivo Support took too long to respond. Please retry.'
            )
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  }
}

export async function getRideArrivoSupportData(
  resource: SupportResource,
  params: Record<
    string,
    string | number | undefined
  > = {}
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.'
    )
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (
    sessionError ||
    !session?.access_token
  ) {
    throw new Error(
      'Your RideArrivo Workspace session has expired.'
    )
  }

  const requestKey = [
    session.user.id,
    resource,
    stableParamsKey(params),
  ].join(':')

  const existing = inflightSupportRequests.get(requestKey)
  if (existing) {
    return existing
  }

  const request = (async () => {
    const invocation = supabase.functions.invoke(
      'ridearrivo-support',
      {
        headers: {
          Authorization:
            `Bearer ${session.access_token}`,
        },
        body: {
          resource,
          params,
        },
      }
    )

    const {
      data,
      error,
    } = await withTimeout(
      invocation,
      SUPPORT_REQUEST_TIMEOUT_MS
    )

    if (error) {
      let message =
        error.message ||
        'Unable to load RideArrivo Support data.'

      try {
        const context =
          (error as any).context

        if (
          context &&
          typeof context.json === 'function'
        ) {
          const responseBody =
            await context.json()

          message =
            responseBody?.error ||
            responseBody?.message ||
            message
        }
      } catch {
        // Preserve the original Supabase error.
      }

      throw new Error(message)
    }

    if (data?.error) {
      throw new Error(
        String(data.error)
      )
    }

    return data
  })()

  inflightSupportRequests.set(
    requestKey,
    request
  )

  try {
    return await request
  } finally {
    if (
      inflightSupportRequests.get(requestKey) === request
    ) {
      inflightSupportRequests.delete(requestKey)
    }
  }
}

// What to do when the media service refuses to let this phone into a call.
//
// The SDK reports failures as text such as
//   "[ERR0002]: {Client} Failed to join room. Check the network and try again."
// Two things were wrong with showing that as it came:
//   1. It means nothing to the person holding the phone.
//   2. Most of these are a moment's trouble (the signalling socket dropped, a
//      stale copy of this same person was still in the room). One quiet retry
//      with a fresh pass from the server fixes them, and the screen used to
//      give up after the first miss.

const CODE = /ERR(\d{4})/i

export function joinFailureCode(raw: string): string {
  return CODE.exec(raw || '')?.[1] || ''
}

// Network, socket and media-route trouble: worth trying again with a new pass.
// 0004 (pass no longer valid) is fixed by exactly that, a new pass.
// 0000/0100 are the SDK's own "internal exception" and are usually transient.
const RETRYABLE = new Set(['0000', '0001', '0002', '0004', '0011', '0012', '0014', '0100'])

export function isRetryableJoinFailure(raw: string): boolean {
  const code = joinFailureCode(raw)
  // No code at all (a plain "Unable to join the call.") is treated as transient.
  return code === '' || RETRYABLE.has(code)
}

// Plain words for the person, with the code kept small at the end so a report
// from a phone can still be traced.
export function joinFailureMessage(raw: string): string {
  const code = joinFailureCode(raw)
  const tag = code ? ` (ERR${code})` : ''
  switch (code) {
    case '0002':
    case '0011':
    case '0012':
      return `Could not reach the call service. If you use a VPN, iCloud Private Relay or Low Data Mode, turn it off, or switch between Wi-Fi and mobile data, then try again.${tag}`
    case '0014':
      return `The call connected but the audio route was blocked. A firewall or network restriction may be in the way. Try another network.${tag}`
    case '0013':
      return `Too many tries in a row. Wait a moment and try again.${tag}`
    case '0004':
      return `This call pass expired. Try again to get a new one.${tag}`
    case '0010':
      return `This browser cannot take part in calls. Open the app in Safari or Chrome.${tag}`
    case '0101':
      return `Microphone or camera access was refused. Allow it in your browser settings and try again.${tag}`
    case '0001':
      return `Could not connect the call. Check your internet connection and try again.${tag}`
    default:
      return raw ? raw : `Could not connect the call. Check your internet connection and try again.${tag}`
  }
}

// Quiet automatic retries before the error screen is shown. Each one asks the
// server for a new pass first (the server removes any stale copy of this
// person from the room), then joins again.
export const MAX_JOIN_RETRIES = 2

export function joinRetryDelay(attempt: number): number {
  return 1200 * Math.max(1, attempt)
}

/*
 * Guest side of the approval queue. Each guest browser holds a random key.
 * The server stores only its hash next to the guest's request, so the host's
 * approval belongs to that browser and cannot be reused by someone who merely
 * knows the approved person's email address.
 */

export function makeRequestKey(
  random: (size: number) => Uint8Array = size => crypto.getRandomValues(new Uint8Array(size)),
): string {
  return Array.from(random(16), byte => byte.toString(16).padStart(2, '0')).join('')
}

export type AdmissionStatus = 'none' | 'pending' | 'approved' | 'denied'

// What the guest page should do after each answer from the server.
export function admissionAction(status: AdmissionStatus | string | undefined):
  'keep_waiting' | 'enter' | 'refused' {
  if (status === 'approved') return 'enter'
  if (status === 'denied') return 'refused'
  return 'keep_waiting'
}

export const POLL_WAITING_MS = 3000

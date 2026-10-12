/*
 * Voice note helpers: choosing a recording format the browser supports, naming
 * the file, and showing durations. Pure functions so they can be tested.
 */

export const MAX_VOICE_MS = 10 * 60 * 1000

// Chrome and Firefox record webm or ogg. Safari records mp4. Ask in this order.
const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of PREFERRED) if (isSupported(mime)) return mime
  return null
}

// 'audio/webm;codecs=opus' -> 'audio/webm'. The bucket stores the plain type.
export const baseMime = (mime: string) => mime.split(';')[0].trim().toLowerCase()

export function extensionForMime(mime: string): string {
  switch (baseMime(mime)) {
    case 'audio/webm': return 'webm'
    case 'audio/mp4': return 'm4a'
    case 'audio/ogg': return 'ogg'
    case 'audio/mpeg': return 'mp3'
    case 'audio/wav':
    case 'audio/x-wav': return 'wav'
    default: return 'audio'
  }
}

export function formatDuration(ms?: number | null): string {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const pad = (value: number) => String(value).padStart(2, '0')

export function voiceFileName(date: Date, mime: string): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`
  return `Voice note ${stamp}.${extensionForMime(mime)}`
}

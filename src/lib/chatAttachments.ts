/*
 * Rules for files sent in chat. Pure functions, so they can be tested without a
 * browser. The database bucket enforces the same limits; this file only exists
 * to tell the person early and in plain words instead of failing at upload.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_FILES_PER_SEND = 5

export const ALLOWED_ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
] as const

// Some browsers report no type, or a generic one, for these. Fall back to the
// extension so a normal .csv or .docx is not refused for no reason.
const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

export const ACCEPT_ATTRIBUTE = Object.keys(EXTENSION_TYPES)
  .map(ext => `.${ext}`)
  .join(',')

export type FileLike = { name: string; size: number; type: string }

export function resolveMime(file: FileLike): string {
  const declared = (file.type || '').toLowerCase()
  if ((ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(declared)) return declared
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[ext] ?? declared
}

export type Verdict = { ok: true; mime: string } | { ok: false; reason: string }

export function validateAttachment(file: FileLike): Verdict {
  if (!file.size) return { ok: false, reason: `${file.name} is empty.` }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: `${file.name} is larger than 25 MB.` }
  }
  const mime = resolveMime(file)
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(mime)) {
    return {
      ok: false,
      reason: `${file.name} cannot be sent here. Send images, audio, PDF, Word, Excel, PowerPoint, text, CSV or ZIP files.`,
    }
  }
  return { ok: true, mime }
}

export const isImageMime = (mime?: string | null) => !!mime && mime.startsWith('image/')
export const isAudioMime = (mime?: string | null) => !!mime && mime.startsWith('audio/')

// Storage keys should stay boring: letters, digits, dot, dash, underscore.
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '')
  if (!cleaned) return 'file'
  if (cleaned.length <= 80) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, 80 - ext.length) + ext
}

// <conversation>/<sender>/<random>-<name>. The storage rules read the first two parts.
export const attachmentPath = (conversationId: string, userId: string, uniqueId: string, name: string) =>
  `${conversationId}/${userId}/${uniqueId}-${safeFileName(name)}`

export function formatBytes(bytes?: number | null): string {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

type WithAttachment = {
  body?: string | null
  attachment_name?: string | null
  attachment_mime?: string | null
  attachment_path?: string | null
}

// One short line for chat lists, replies and notifications.
export function messagePreview(message: WithAttachment): string {
  const text = (message.body || '').trim()
  if (text) return text
  if (!message.attachment_name && !message.attachment_path) return ''
  if (isAudioMime(message.attachment_mime)) return 'Voice note'
  return isImageMime(message.attachment_mime) ? 'Photo' : `File: ${message.attachment_name || 'attachment'}`
}

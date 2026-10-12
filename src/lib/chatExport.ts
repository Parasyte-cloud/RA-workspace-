/*
 * Turning a conversation into a readable text file, and naming files inside an
 * export so two files with the same name never overwrite each other.
 */

export type ExportMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  reply_to_id?: string | null
  attachment_name?: string | null
  attachment_mime?: string | null
  attachment_size?: number | null
  attachment_duration_ms?: number | null
}

const pad = (value: number) => String(value).padStart(2, '0')

export function stamp(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const size = (bytes?: number | null) => {
  const n = Number(bytes || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function describeAttachment(message: ExportMessage, savedAs?: string): string {
  if (!message.attachment_name) return ''
  const kind = (message.attachment_mime || '').startsWith('image/')
    ? 'Image'
    : (message.attachment_mime || '').startsWith('audio/') ? 'Voice note' : 'File'
  const where = savedAs ? ` -> ${savedAs}` : ''
  return `[${kind}: ${message.attachment_name} (${size(message.attachment_size)})${where}]`
}

export function buildTranscript(input: {
  title: string
  exportedBy: string
  exportedAt: Date
  messages: ExportMessage[]
  nameOf: (userId: string) => string
  savedAs?: Map<string, string>
}): string {
  const { title, exportedBy, exportedAt, messages, nameOf, savedAs } = input
  const byId = new Map(messages.map(message => [message.id, message]))
  const lines: string[] = [
    `RideArrivo chat: ${title}`,
    `Exported by ${exportedBy} on ${stamp(exportedAt)}`,
    `${messages.length} message${messages.length === 1 ? '' : 's'}`,
    '',
  ]

  let lastDay = ''
  for (const message of messages) {
    const when = stamp(message.created_at)
    const day = when.slice(0, 10)
    if (day && day !== lastDay) {
      lines.push(`--- ${day} ---`)
      lastDay = day
    }
    const head = `[${when.slice(11)}] ${nameOf(message.sender_id)}:`
    if (message.reply_to_id) {
      const original = byId.get(message.reply_to_id)
      const quoted = original
        ? `${nameOf(original.sender_id)}: ${(original.body || original.attachment_name || '').replace(/\s+/g, ' ').slice(0, 80)}`
        : 'an earlier message'
      lines.push(`${head} (replying to ${quoted})`)
    }
    const attachment = describeAttachment(message, savedAs?.get(message.id))
    if (message.body) {
      const [first, ...rest] = message.body.split('\n')
      lines.push(message.reply_to_id ? `    ${first}` : `${head} ${first}`)
      for (const line of rest) lines.push(`    ${line}`)
    } else if (!message.reply_to_id && attachment) {
      lines.push(`${head} ${attachment}`)
      continue
    }
    if (attachment && (message.body || message.reply_to_id)) lines.push(`    ${attachment}`)
  }
  return lines.join('\n') + '\n'
}

// files/<name>, files/<name> (2), ... so nothing is overwritten inside a zip.
export function uniqueZipName(taken: Set<string>, name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'file'
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const ext = dot > 0 ? clean.slice(dot) : ''
  let candidate = clean
  let n = 2
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n})${ext}`
    n += 1
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

export const exportFileName = (title: string, date: Date, ext: 'txt' | 'zip') =>
  `RideArrivo chat with ${title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'colleague'} ${stamp(date).slice(0, 10)}.${ext}`

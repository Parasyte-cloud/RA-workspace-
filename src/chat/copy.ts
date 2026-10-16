// Copy a message's text. Pure helper plus a clipboard call with an old-browser fallback.
export function copyableText(message: { body?: string | null; attachment_name?: string | null; deleted_at?: string | null }): string {
  if (message.deleted_at) return ''
  const body = (message.body || '').trim()
  if (body) return body
  return (message.attachment_name || '').trim()
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the older way
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

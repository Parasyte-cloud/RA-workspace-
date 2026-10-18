/*
 * Reading font choice. System font stacks only, so nothing is downloaded and
 * every choice works offline. Kept on this device.
 */
export type FontStyleId = 'default' | 'rounded' | 'serif' | 'editorial' | 'mono' | 'classic'

export const FONT_STYLES: { id: FontStyleId; label: string; hint: string; stack: string }[] = [
  { id: 'default', label: 'Standard', hint: 'The RideArrivo look', stack: '' },
  { id: 'rounded', label: 'Rounded', hint: 'Soft and friendly', stack: 'ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', hint: 'Warm, like a book', stack: 'ui-serif, "New York", Georgia, "Times New Roman", serif' },
  { id: 'editorial', label: 'Editorial', hint: 'Elegant, like a magazine', stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  { id: 'classic', label: 'Typewriter', hint: 'Classic notepad feel', stack: '"American Typewriter", "Courier New", Courier, monospace' },
  { id: 'mono', label: 'Code', hint: 'Clean and technical', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
]

export const FONT_KEY = 'ra-font-style'

export function isFontStyleId(value: unknown): value is FontStyleId {
  return typeof value === 'string' && FONT_STYLES.some(item => item.id === value)
}

export function readFontStyle(): FontStyleId {
  try {
    const value = window.localStorage.getItem(FONT_KEY)
    return isFontStyleId(value) ? value : 'default'
  } catch {
    return 'default'
  }
}

export function applyFontStyle(id: FontStyleId) {
  if (typeof document === 'undefined') return
  const style = FONT_STYLES.find(item => item.id === id) ?? FONT_STYLES[0]
  const root = document.documentElement
  if (style.stack) {
    root.setAttribute('data-ra-font', style.id)
    root.style.setProperty('--ra-font-user', style.stack)
  } else {
    root.removeAttribute('data-ra-font')
    root.style.removeProperty('--ra-font-user')
  }
}

export function saveFontStyle(id: FontStyleId) {
  try {
    window.localStorage.setItem(FONT_KEY, id)
  } catch {
    /* storage can be blocked; the choice then lasts until reload */
  }
  applyFontStyle(id)
}

export function applyStoredFontStyle() {
  applyFontStyle(readFontStyle())
}

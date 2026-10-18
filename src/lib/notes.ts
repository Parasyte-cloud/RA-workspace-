/*
 * The rules of the Notes notepad, with no React and no network, so they can be
 * tested on their own.
 *
 * A note's body is plain text. A line is one of:
 *   "- [ ] buy tyres"   a checklist item, not done
 *   "- [x] buy tyres"   a checklist item, done
 *   "- tyres"           a bullet
 *   "tyres"             ordinary text
 */

export type NoteKind = 'text' | 'todo' | 'bullet'
export type NoteLine = { kind: NoteKind; done: boolean; text: string }

export type Stroke = { c: string; w: number; p: Array<[number, number]> }

export type Note = {
  id: string
  title: string
  body: string
  sketch: Stroke[] | null
  pinned: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export const TRASH_DAYS = 30
export const MAX_BODY = 200_000
export const MAX_SKETCH_BYTES = 500_000

export function parseBody(body: string): NoteLine[] {
  const lines = (body || '').split('\n')
  return lines.map<NoteLine>(line => {
    const todo = line.match(/^- \[( |x|X)\] ?(.*)$/)
    if (todo) return { kind: 'todo', done: todo[1].toLowerCase() === 'x', text: todo[2] }
    const bullet = line.match(/^- (.*)$/)
    if (bullet) return { kind: 'bullet', done: false, text: bullet[1] }
    return { kind: 'text', done: false, text: line }
  })
}

export function serializeBody(lines: readonly NoteLine[]): string {
  return lines
    .map(line => {
      if (line.kind === 'todo') return `- [${line.done ? 'x' : ' '}] ${line.text}`
      if (line.kind === 'bullet') return `- ${line.text}`
      return line.text
    })
    .join('\n')
}

// What a new line after this one starts as: a checklist or bullet carries on.
export function nextLineAfter(line: NoteLine): NoteLine {
  if (line.kind === 'todo') return { kind: 'todo', done: false, text: '' }
  if (line.kind === 'bullet') return { kind: 'bullet', done: false, text: '' }
  return { kind: 'text', done: false, text: '' }
}

// Enter on an empty checklist or bullet line ends the list, like Apple Notes.
export function isEmptyListLine(line: NoteLine): boolean {
  return line.kind !== 'text' && line.text.trim() === ''
}

export function toggleKind(line: NoteLine, kind: NoteKind): NoteLine {
  return line.kind === kind ? { ...line, kind: 'text', done: false } : { ...line, kind, done: false }
}

// The list shows the first line as the title when the person did not type one.
export function noteTitle(note: Pick<Note, 'title' | 'body'>): string {
  const typed = note.title.trim()
  if (typed) return typed
  const first = parseBody(note.body).find(line => line.text.trim())
  return first ? first.text.trim().slice(0, 80) : 'New note'
}

export function notePreview(note: Pick<Note, 'title' | 'body'>): string {
  const lines = parseBody(note.body).map(line => line.text.trim()).filter(Boolean)
  const skip = note.title.trim() ? 0 : 1
  return lines.slice(skip, skip + 2).join(' ').slice(0, 120) || 'No additional text'
}

export function matchesSearch(note: Pick<Note, 'title' | 'body'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${note.title}\n${note.body}`.toLowerCase().includes(needle)
}

export function checklistProgress(body: string): { done: number; total: number } {
  const todos = parseBody(body).filter(line => line.kind === 'todo')
  return { done: todos.filter(line => line.done).length, total: todos.length }
}

// Pinned first, then most recently changed.
export function sortNotes<T extends Pick<Note, 'pinned' | 'updated_at'>>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return Date.parse(b.updated_at) - Date.parse(a.updated_at)
  })
}

export function isInTrash(note: Pick<Note, 'deleted_at'>): boolean {
  return Boolean(note.deleted_at)
}

export function trashExpired(note: Pick<Note, 'deleted_at'>, now = Date.now()): boolean {
  if (!note.deleted_at) return false
  return now - Date.parse(note.deleted_at) > TRASH_DAYS * 86_400_000
}

export function daysLeftInTrash(note: Pick<Note, 'deleted_at'>, now = Date.now()): number {
  if (!note.deleted_at) return TRASH_DAYS
  const used = Math.floor((now - Date.parse(note.deleted_at)) / 86_400_000)
  return Math.max(0, TRASH_DAYS - used)
}

// A short date like Apple Notes: the time today, "Yesterday", the weekday this
// week, otherwise the date.
export function noteDate(iso: string, now = new Date()): string {
  const then = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return then.toLocaleDateString([], { weekday: 'long' })
  return then.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export function sketchSize(strokes: readonly Stroke[] | null): number {
  return strokes ? JSON.stringify(strokes).length : 0
}

// Keep a stroke list inside the size the database accepts, dropping the oldest
// strokes first.
export function fitSketch(strokes: readonly Stroke[]): Stroke[] {
  const list = [...strokes]
  while (list.length > 1 && sketchSize(list) > MAX_SKETCH_BYTES) list.shift()
  return list
}

export function strokePath(stroke: Stroke): string {
  const pts = stroke.p
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}h.01`
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
}

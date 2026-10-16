// Who is typing right now, for rooms and direct chats. Pure.
export const TYPING_TTL_MS = 5000

export type Typer = { id: string; name: string; at: number }

export function addTyper(list: Typer[], id: string, name: string, now: number): Typer[] {
  const fresh = list.filter(item => item.id !== id && now - item.at < TYPING_TTL_MS)
  return [...fresh, { id, name: name.trim() || 'Someone', at: now }]
}

export function liveTypers(list: Typer[], now: number): Typer[] {
  return list.filter(item => now - item.at < TYPING_TTL_MS)
}

export function typingSentence(names: string[]): string {
  const clean = names.map(name => name.trim().split(/\s+/)[0]).filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return `${clean[0]} is typing...`
  if (clean.length === 2) return `${clean[0]} and ${clean[1]} are typing...`
  return `${clean[0]}, ${clean[1]} and ${clean.length - 2} other${clean.length - 2 === 1 ? '' : 's'} are typing...`
}

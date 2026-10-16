// Waiting room chat helpers. Pure so they can be tested without a database.

export const LOBBY_MAX_LENGTH = 500

// Trim, drop control characters, keep line breaks tidy. Returns null when
// nothing usable is left.
export function cleanLobbyBody(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!text) return null
  return text.slice(0, LOBBY_MAX_LENGTH)
}

export type LobbyRow = {
  id: string
  author_kind: "guest" | "host"
  author_name: string
  request_id: string | null
  body: string
  created_at: string
}

export type LobbyMessage = {
  id: string
  from: "guest" | "host"
  name: string
  body: string
  at: string
  mine: boolean
}

// What the browser sees. Guests never learn another guest's request id or
// email, only the display name they typed.
export function shapeLobby(rows: LobbyRow[], viewerRequestId: string | null): LobbyMessage[] {
  return rows
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(row => ({
      id: row.id,
      from: row.author_kind,
      name: row.author_kind === "host" ? "Host" : row.author_name,
      body: row.body,
      at: row.created_at,
      mine: viewerRequestId !== null && row.request_id === viewerRequestId,
    }))
}

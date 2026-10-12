/*
 * Rules for the Archive page. Pure functions so they can be tested without a
 * browser. The database and the storage bucket enforce the same limits; this
 * file only exists to tell people early and in plain words.
 */

export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
export const BIN_DAYS = 30
export const DEFAULT_FOLDER = 'General'

export const ARCHIVE_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/csv', 'application/rtf',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
  'video/mp4', 'video/quicktime', 'video/webm',
] as const

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
}

export const ARCHIVE_ACCEPT = Object.keys(EXTENSION_TYPES).map(ext => `.${ext}`).join(',')

export type FileLike = { name: string; size: number; type: string }
export type Verdict = { ok: true; mime: string } | { ok: false; reason: string }

export function resolveArchiveMime(file: FileLike): string {
  const declared = (file.type || '').toLowerCase()
  if ((ARCHIVE_TYPES as readonly string[]).includes(declared)) return declared
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[ext] ?? declared
}

export function validateArchiveFile(file: FileLike): Verdict {
  if (!file.size) return { ok: false, reason: `${file.name} is empty.` }
  if (file.size > MAX_ARCHIVE_BYTES) return { ok: false, reason: `${file.name} is larger than 50 MB.` }
  const mime = resolveArchiveMime(file)
  if (!(ARCHIVE_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, reason: `${file.name} is a type the Archive does not accept. Programs, scripts and web pages are not allowed.` }
  }
  return { ok: true, mime }
}

// Letters, numbers, dot, dash and underscore only; never empty; keeps the extension.
export function safeFileName(name: string): string {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '')
  return (cleaned || 'file').slice(-120)
}

// <user id>/<file id>-<safe name>. The first part is what the storage rules check.
export function archivePath(userId: string, fileId: string, name: string): string {
  return `${userId}/${fileId}-${safeFileName(name)}`
}

export function normaliseFolder(value: string | null | undefined): string {
  const clean = (value || '').replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return clean || DEFAULT_FOLDER
}

export type Kind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'video' | 'audio' | 'zip' | 'text' | 'other'

export function kindOf(mime: string): Kind {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/zip') return 'zip'
  if (m.includes('wordprocessingml') || m === 'application/msword' || m === 'application/rtf') return 'doc'
  if (m.includes('spreadsheetml') || m === 'application/vnd.ms-excel' || m === 'text/csv') return 'sheet'
  if (m.includes('presentationml') || m === 'application/vnd.ms-powerpoint') return 'slides'
  if (m.startsWith('text/')) return 'text'
  return 'other'
}

// Files the viewer inside the workspace can show. Anything else is downloaded.
export type ViewerMode = 'image' | 'video' | 'audio' | 'pdf' | 'text'

export function viewerMode(mime: string): ViewerMode | null {
  const k = kindOf(mime)
  return k === 'image' || k === 'video' || k === 'audio' || k === 'pdf' || k === 'text' ? k : null
}

export const canPreview = (mime: string) => viewerMode(mime) !== null

// Text previews show the start of the file only.
export const MAX_TEXT_PREVIEW_CHARS = 200_000

export type ArchiveRow = {
  id: string
  name: string
  description: string | null
  folder: string
  storage_path: string
  mime_type: string
  size_bytes: number
  visibility: 'company' | 'department' | 'private'
  uploaded_by: string | null
  uploader_name: string
  deleted_at: string | null
  created_at: string
  updated_at: string
  can_manage: boolean
}

export type SortKey = 'newest' | 'oldest' | 'name' | 'size'

export type Filters = {
  query?: string
  folder?: string
  kind?: Kind | ''
  mineOnly?: boolean
  userId?: string
  sort?: SortKey
}

export function filterAndSort(rows: ArchiveRow[], f: Filters): ArchiveRow[] {
  const words = (f.query || '').toLowerCase().split(/\s+/).filter(Boolean)
  const out = rows.filter(row => {
    if (f.folder && row.folder !== f.folder) return false
    if (f.kind && kindOf(row.mime_type) !== f.kind) return false
    if (f.mineOnly && row.uploaded_by !== f.userId) return false
    if (words.length) {
      const hay = `${row.name} ${row.description || ''} ${row.folder} ${row.uploader_name}`.toLowerCase()
      if (!words.every(w => hay.includes(w))) return false
    }
    return true
  })
  const by: Record<SortKey, (a: ArchiveRow, b: ArchiveRow) => number> = {
    newest: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    oldest: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    size: (a, b) => b.size_bytes - a.size_bytes,
  }
  return out.sort(by[f.sort || 'newest'])
}

export function folderCounts(rows: ArchiveRow[]): { folder: string; count: number }[] {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.folder, (map.get(row.folder) || 0) + 1)
  return [...map.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' }))
}

export function binDaysLeft(deletedAt: string | null, now = Date.now()): number {
  if (!deletedAt) return BIN_DAYS
  const used = (now - Date.parse(deletedAt)) / 86400000
  return Math.max(0, Math.ceil(BIN_DAYS - used))
}

export const binExpired = (deletedAt: string | null, now = Date.now()) =>
  !!deletedAt && now - Date.parse(deletedAt) >= BIN_DAYS * 86400000

export const VISIBILITY_LABEL: Record<ArchiveRow['visibility'], string> = {
  company: 'Everyone',
  department: 'My department',
  private: 'Only me',
}

// ---- Folder limits and outside links ---------------------------------------

export type FolderLimit = { folder: string; departments: string[] }

export const folderKey = (name: string) => normaliseFolder(name).toLowerCase()

export function limitFor(limits: FolderLimit[], folder: string): FolderLimit | undefined {
  const key = folderKey(folder)
  return limits.find(l => folderKey(l.folder) === key)
}

// Every folder name that exists, from files and from limits, once each.
export function allFolderNames(rows: ArchiveRow[], limits: FolderLimit[]): string[] {
  const seen = new Map<string, string>()
  for (const name of [...rows.map(r => r.folder), ...limits.map(l => l.folder)]) {
    const key = folderKey(name)
    if (!seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export const SHARE_DAY_OPTIONS = [1, 7, 30] as const
export const DEFAULT_SHARE_DAYS = 7

export function shareUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/functions/v1/archive-share?t=${encodeURIComponent(token)}`
}

export type ShareRow = {
  id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  download_count: number
  last_accessed_at: string | null
  created_by_name: string
}

export type ShareState = 'active' | 'expired' | 'revoked'

export function shareState(share: Pick<ShareRow, 'expires_at' | 'revoked_at'>, now = Date.now()): ShareState {
  if (share.revoked_at) return 'revoked'
  return Date.parse(share.expires_at) > now ? 'active' : 'expired'
}

// Database messages in words a person can act on.
export function friendlyArchiveError(message: string): string {
  if (/row-level security|violates row level/i.test(message)) {
    return 'You do not have access to that folder, or the file could not be saved. Pick another folder.'
  }
  if (/10 active links/i.test(message)) return message
  if (/Only an administrator/i.test(message)) return 'Only an administrator can do that.'
  return message
}

// A small IndexedDB buffer for recording chunks. Every chunk is written here
// BEFORE it is uploaded, so a dropped connection, a reload or a crash cannot
// lose audio: on the next visit the leftovers are uploaded and the meeting is
// finished. Once the server confirms a chunk the audio bytes are dropped and
// only a tiny "uploaded" marker stays, so the buffer does not grow.

// Every chunk is ALSO held in memory until the server confirms it. If IndexedDB
// is unavailable or a write fails (private browsing, quota, a blocked database),
// the chunk is still uploaded from memory instead of being lost. Memory holds
// about 40 KB per 10 second chunk, so even a very long meeting stays small.
const memory = new Map<string, Map<number, StoredChunk>>()
const uploadedInMemory = new Map<string, Set<number>>()

function memFor(sessionId: string) {
  let m = memory.get(sessionId)
  if (!m) { m = new Map(); memory.set(sessionId, m) }
  return m
}

const DB = 'ra-r7-ai'
const CHUNKS = 'chunks'
const META = 'meta'

export type StoredChunk = {
  sessionId: string
  seq: number
  mime: string
  blob: Blob | null
  bytes: number
  uploaded: boolean
}

export type SessionMeta = {
  sessionId: string
  title: string
  live: boolean
  startedAt: number
  lastSeenAt: number
  elapsedMs: number
  ended: boolean
  expected: number | null
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['sessionId', 'seq'] })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'sessionId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// Memory first, then the durable buffer. A rejected promise means the durable
// copy failed; the chunk is still in memory and will still be uploaded.
export async function putChunk(c: StoredChunk): Promise<void> {
  if (c.blob && !c.uploaded) memFor(c.sessionId).set(c.seq, c)
  await run(CHUNKS, 'readwrite', s => s.put(c))
}

export async function chunksFor(sessionId: string): Promise<StoredChunk[]> {
  let stored: StoredChunk[] = []
  try {
    stored = await run<StoredChunk[]>(CHUNKS, 'readonly', s =>
      s.getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])) as IDBRequest<StoredChunk[]>)
  } catch { /* durable buffer unavailable: fall back to memory alone */ }
  const bySeq = new Map<number, StoredChunk>()
  for (const c of stored) bySeq.set(c.seq, c)
  for (const [seq, c] of memFor(sessionId)) bySeq.set(seq, c)
  const done = uploadedInMemory.get(sessionId)
  // A confirmed chunk must stay countable even when the durable copy is gone.
  for (const seq of done ?? []) {
    if (!bySeq.has(seq)) bySeq.set(seq, { sessionId, seq, mime: '', blob: null, bytes: 0, uploaded: true })
  }
  return [...bySeq.values()]
    .map(c => (done?.has(c.seq) ? { ...c, blob: null, uploaded: true } : c))
    .sort((a, b) => a.seq - b.seq)
}

export async function markUploaded(sessionId: string, seq: number) {
  // Remember it in memory first so a failed marker write cannot cause a re-upload loop.
  let set = uploadedInMemory.get(sessionId)
  if (!set) { set = new Set(); uploadedInMemory.set(sessionId, set) }
  set.add(seq)
  memFor(sessionId).delete(seq)
  try {
    const hit = (await run<StoredChunk[]>(CHUNKS, 'readonly', s =>
      s.getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])) as IDBRequest<StoredChunk[]>)).find(c => c.seq === seq)
    if (hit) await run(CHUNKS, 'readwrite', s => s.put({ ...hit, blob: null, uploaded: true }))
  } catch { /* the upload is confirmed; only the on-device marker is missing */ }
}

export const putMeta = (m: SessionMeta) => run(META, 'readwrite', s => s.put(m))
export const getMeta = (sessionId: string) => run<SessionMeta | undefined>(META, 'readonly', s => s.get(sessionId) as IDBRequest<SessionMeta | undefined>)
export const listMeta = () => run<SessionMeta[]>(META, 'readonly', s => s.getAll() as IDBRequest<SessionMeta[]>)

export async function forgetSession(sessionId: string) {
  memory.delete(sessionId)
  uploadedInMemory.delete(sessionId)
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS, META], 'readwrite')
      tx.objectStore(META).delete(sessionId)
      tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// Sessions with audio that never reached the server, or that never finished.
export async function recoverable(): Promise<{ meta: SessionMeta; pending: number; total: number }[]> {
  let metas: SessionMeta[] = []
  try { metas = await listMeta() } catch { return [] }
  const out: { meta: SessionMeta; pending: number; total: number }[] = []
  for (const meta of metas) {
    const chunks = await chunksFor(meta.sessionId)
    const pending = chunks.filter(c => !c.uploaded).length
    if (pending > 0 || !meta.ended) out.push({ meta, pending, total: chunks.length })
  }
  return out
}

// A small IndexedDB buffer for recording chunks. Every chunk is written here
// BEFORE it is uploaded, so a dropped connection, a reload or a crash cannot
// lose audio: on the next visit the leftovers are uploaded and the meeting is
// finished. Once the server confirms a chunk the audio bytes are dropped and
// only a tiny "uploaded" marker stays, so the buffer does not grow.

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

export const putChunk = (c: StoredChunk) => run(CHUNKS, 'readwrite', s => s.put(c))

export async function chunksFor(sessionId: string): Promise<StoredChunk[]> {
  const all = await run<StoredChunk[]>(CHUNKS, 'readonly', s =>
    s.getAll(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])) as IDBRequest<StoredChunk[]>)
  return all.sort((a, b) => a.seq - b.seq)
}

export async function markUploaded(sessionId: string, seq: number) {
  const all = await chunksFor(sessionId)
  const hit = all.find(c => c.seq === seq)
  if (hit) await putChunk({ ...hit, blob: null, uploaded: true })
}

export const putMeta = (m: SessionMeta) => run(META, 'readwrite', s => s.put(m))
export const getMeta = (sessionId: string) => run<SessionMeta | undefined>(META, 'readonly', s => s.get(sessionId) as IDBRequest<SessionMeta | undefined>)
export const listMeta = () => run<SessionMeta[]>(META, 'readonly', s => s.getAll() as IDBRequest<SessionMeta[]>)

export async function forgetSession(sessionId: string) {
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

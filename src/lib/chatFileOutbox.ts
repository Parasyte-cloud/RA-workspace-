const DB_NAME = 'ra-chat-file-outbox'
const STORE = 'pending-files'
const DB_VERSION = 1

export type PendingFileRetry = {
  tempId: string
  userId: string
  conversationId: string
  body: string
  replyId: string | null
  clientMessageId: string
  mentionedUserIds: string[]
  durationMs: number | null
  queuedAt: number
  file: File
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'tempId' })
        store.createIndex('userConversation', ['userId', 'conversationId'], { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open file outbox'))
  })
}

async function tx<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = work(transaction.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('File outbox operation failed'))
      transaction.onabort = () => reject(transaction.error || new Error('File outbox transaction aborted'))
    })
  } finally {
    db.close()
  }
}

export async function savePendingFileRetry(item: PendingFileRetry): Promise<void> {
  await tx('readwrite', store => store.put(item))
}

export async function loadPendingFileRetry(tempId: string): Promise<PendingFileRetry | null> {
  const value = await tx<PendingFileRetry | undefined>('readonly', store => store.get(tempId))
  return value || null
}

export async function removePendingFileRetry(tempId: string): Promise<void> {
  await tx('readwrite', store => store.delete(tempId))
}

export async function listPendingFileRetries(userId: string, conversationId: string): Promise<PendingFileRetry[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly')
      const index = transaction.objectStore(STORE).index('userConversation')
      const request = index.getAll(IDBKeyRange.only([userId, conversationId]))
      request.onsuccess = () => resolve((request.result || []) as PendingFileRetry[])
      request.onerror = () => reject(request.error || new Error('Unable to read file outbox'))
    })
  } finally {
    db.close()
  }
}

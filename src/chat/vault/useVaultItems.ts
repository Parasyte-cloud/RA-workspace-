import { useEffect, useMemo, useState } from 'react'
import { loadVaultItems, watchVaultItems } from './vaultApi'
import type { VaultItem } from './vaultFormat'

export type VaultView = {
  byId: Record<string, VaultItem>
  byMessage: Record<string, VaultItem>
}

// The state of every locked card in the open chat. Loads them and then follows
// changes live (opened, locked, unblocked, deleted). Only the state of a card
// ever travels here, never what is inside it. Before the database is set up the
// load simply returns nothing and the chat behaves as it always did.
export function useVaultItems(conversationId: string): VaultView {
  const [items, setItems] = useState<Record<string, VaultItem>>({})

  useEffect(() => {
    setItems({})
    if (!conversationId) return
    let alive = true
    const load = () => {
      void loadVaultItems(conversationId).then(rows => {
        if (!alive || !rows.length) return
        setItems(current => {
          const next = { ...current }
          for (const row of rows) next[row.id] = row
          return next
        })
      })
    }
    load()
    // A phone that slept may have missed live changes.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    const stop = watchVaultItems(conversationId, row => {
      setItems(current => ({ ...current, [row.id]: { ...current[row.id], ...row } }))
    })
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      stop()
    }
  }, [conversationId])

  return useMemo(() => {
    const byMessage: Record<string, VaultItem> = {}
    for (const item of Object.values(items)) if (item.message_id) byMessage[item.message_id] = item
    return { byId: items, byMessage }
  }, [items])
}

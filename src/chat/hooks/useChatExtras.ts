import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyReactionChange,
  AVATAR_PIXELS,
  groupReactions,
  isValidEmoji,
  statusActive,
} from '../../lib/chatExtras'
import type { ChatStatus, ReactionGroup, ReactionRow } from '../../lib/chatExtras'
import {
  fetchChatProfiles,
  fetchPins,
  fetchReactions,
  prepareAvatar,
  removeChatAvatar,
  saveChatProfile,
  setPinned as setPinnedApi,
  signAvatarUrls,
  toggleReaction,
  uploadChatAvatar,
} from '../api/chatExtras'
import type { ChatProfile, PinRow } from '../api/chatExtras'

type Options = {
  client: SupabaseClient | null
  userId: string
  conversationId: string
  messageIds: string[]
  onError: (message: string) => void
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

export function useChatExtras({ client, userId, conversationId, messageIds, onError }: Options) {
  const [reactions, setReactions] = useState<Map<string, ReactionRow[]>>(new Map())
  const [pins, setPins] = useState<PinRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, ChatProfile>>(new Map())
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const fetched = useRef<Set<string>>(new Set())
  const errorRef = useRef(onError)
  errorRef.current = onError

  // Profiles (photo and status) for everyone, loaded once.
  const loadProfiles = useCallback(async () => {
    if (!client || !userId) return
    try {
      const rows = await fetchChatProfiles(client)
      setProfiles(new Map(rows.map(row => [row.user_id, row])))
    } catch { /* The chat still works with initials only. */ }
  }, [client, userId])

  useEffect(() => { void loadProfiles() }, [loadProfiles])

  const avatarKey = useMemo(
    () => Array.from(profiles.values()).map(p => p.avatar_path || '').filter(Boolean).sort().join('|'),
    [profiles],
  )
  useEffect(() => {
    if (!client || !avatarKey) return
    const missing = avatarKey.split('|').filter(path => !urls[path])
    if (!missing.length) return
    let cancelled = false
    signAvatarUrls(client, missing)
      .then(map => { if (!cancelled) setUrls(current => ({ ...current, ...map })) })
      .catch(() => {})
    return () => { cancelled = true }
    // urls is read to find gaps but must not retrigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, avatarKey])

  // Reactions for the messages on screen.
  const idsKey = messageIds.join(',')
  useEffect(() => {
    if (!client || !userId) return
    const fresh = messageIds.filter(id => !fetched.current.has(id) && !id.startsWith('local-'))
    if (!fresh.length) return
    fresh.forEach(id => fetched.current.add(id))
    let cancelled = false
    fetchReactions(client, fresh)
      .then(rows => {
        if (cancelled) return
        setReactions(current => {
          const next = new Map(current)
          for (const id of fresh) next.set(id, [])
          for (const row of rows) next.set(row.message_id, [...(next.get(row.message_id) || []), row])
          return next
        })
      })
      .catch(() => fresh.forEach(id => fetched.current.delete(id)))
    return () => { cancelled = true }
    // idsKey stands in for messageIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId, idsKey])

  // Pins of the open conversation.
  const loadPins = useCallback(async () => {
    if (!client || !conversationId) { setPins([]); return }
    try { setPins(await fetchPins(client, conversationId)) } catch { setPins([]) }
  }, [client, conversationId])
  useEffect(() => { void loadPins() }, [loadPins])

  // Live updates. Handlers read refs so the channel is built once per session.
  const conversationRef = useRef(conversationId)
  conversationRef.current = conversationId
  useEffect(() => {
    if (!client || !userId) return
    const channel = client
      .channel(`chat-extras-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_message_reactions' }, payload => {
        const row = payload.new as ReactionRow
        setReactions(current => {
          if (!current.has(row.message_id)) return current
          const next = new Map(current)
          next.set(row.message_id, applyReactionChange(next.get(row.message_id) || [], { type: 'add', row }))
          return next
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_message_reactions' }, payload => {
        const row = payload.old as ReactionRow
        if (!row?.message_id) return
        setReactions(current => {
          if (!current.has(row.message_id)) return current
          const next = new Map(current)
          next.set(row.message_id, applyReactionChange(next.get(row.message_id) || [], { type: 'remove', row }))
          return next
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_pinned_messages' }, payload => {
        const row = (payload.new && 'message_id' in payload.new ? payload.new : payload.old) as Partial<PinRow>
        if (row.conversation_id && row.conversation_id !== conversationRef.current) return
        void loadPins()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_profiles' }, () => { void loadProfiles() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [client, userId, loadPins, loadProfiles])

  const react = useCallback(async (messageId: string, emoji: string) => {
    if (!client || !userId || !isValidEmoji(emoji)) return
    const mine = (reactions.get(messageId) || []).some(r => r.user_id === userId && r.emoji === emoji)
    const row: ReactionRow = { message_id: messageId, user_id: userId, emoji }
    // Show the change at once, then confirm with the server.
    setReactions(current => {
      const next = new Map(current)
      next.set(messageId, applyReactionChange(next.get(messageId) || [], { type: mine ? 'remove' : 'add', row }))
      return next
    })
    try {
      await toggleReaction(client, messageId, emoji)
    } catch (error) {
      setReactions(current => {
        const next = new Map(current)
        next.set(messageId, applyReactionChange(next.get(messageId) || [], { type: mine ? 'add' : 'remove', row }))
        return next
      })
      errorRef.current(messageOf(error, 'Could not save your reaction.'))
    }
  }, [client, userId, reactions])

  const setPinned = useCallback(async (messageId: string, pinned: boolean) => {
    if (!client) return
    try {
      await setPinnedApi(client, messageId, pinned)
      await loadPins()
    } catch (error) {
      errorRef.current(messageOf(error, 'Could not update the pin.'))
    }
  }, [client, loadPins])

  const mine = profiles.get(userId) || null

  const saveStatus = useCallback(async (status: ChatStatus) => {
    if (!client || !userId) return
    setBusy(true)
    try {
      await saveChatProfile(client, userId, {
        status_emoji: status.emoji,
        status_text: status.text,
        status_until: status.until,
      })
      await loadProfiles()
    } catch (error) {
      errorRef.current(messageOf(error, 'Could not save your status.'))
    } finally {
      setBusy(false)
    }
  }, [client, userId, loadProfiles])

  const uploadAvatar = useCallback(async (file: File) => {
    if (!client || !userId) return
    setBusy(true)
    try {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.')
      const blob = await prepareAvatar(file, AVATAR_PIXELS)
      const path = await uploadChatAvatar(client, userId, blob, mine?.avatar_path || null)
      await saveChatProfile(client, userId, { avatar_path: path })
      await loadProfiles()
    } catch (error) {
      errorRef.current(messageOf(error, 'Could not upload the picture.'))
    } finally {
      setBusy(false)
    }
  }, [client, userId, mine?.avatar_path, loadProfiles])

  const removeAvatar = useCallback(async () => {
    if (!client || !userId || !mine?.avatar_path) return
    setBusy(true)
    try {
      await saveChatProfile(client, userId, { avatar_path: null })
      await removeChatAvatar(client, mine.avatar_path)
      await loadProfiles()
    } catch (error) {
      errorRef.current(messageOf(error, 'Could not remove the picture.'))
    } finally {
      setBusy(false)
    }
  }, [client, userId, mine?.avatar_path, loadProfiles])

  const groupsFor = useCallback(
    (messageId: string): ReactionGroup[] => groupReactions(reactions.get(messageId) || [], userId || null),
    [reactions, userId],
  )

  const avatarUrl = useCallback(
    (id?: string | null): string | null => {
      const path = id ? profiles.get(id)?.avatar_path : null
      return path ? urls[path] || null : null
    },
    [profiles, urls],
  )

  const statusOf = useCallback(
    (id?: string | null): ChatStatus | null => {
      const p = id ? profiles.get(id) : null
      if (!p) return null
      const status = { emoji: p.status_emoji, text: p.status_text, until: p.status_until }
      return statusActive(status) ? status : null
    },
    [profiles],
  )

  return {
    groupsFor, react,
    pins, setPinned, isPinned: (id: string) => pins.some(p => p.message_id === id),
    avatarUrl, statusOf, mine, busy,
    saveStatus, uploadAvatar, removeAvatar,
  }
}

export type ChatExtras = ReturnType<typeof useChatExtras>

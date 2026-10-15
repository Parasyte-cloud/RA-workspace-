import type { SupabaseClient } from '@supabase/supabase-js'
import { avatarExtension, avatarPathFor, cleanSearchQuery, escapeLike } from '../../lib/chatExtras'
import type { ReactionRow } from '../../lib/chatExtras'

export type ChatProfile = {
  user_id: string
  avatar_path: string | null
  status_emoji: string | null
  status_text: string | null
  status_until: string | null
}

export type PinRow = { message_id: string; conversation_id: string; pinned_by: string; pinned_at: string }

export type SearchHit = { id: string; sender_id: string; body: string; created_at: string }

const AVATAR_BUCKET = 'chat-avatars'
const SIGNED_SECONDS = 12 * 3600
const CHUNK = 150

export async function fetchReactions(client: SupabaseClient, messageIds: string[]): Promise<ReactionRow[]> {
  const out: ReactionRow[] = []
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const ids = messageIds.slice(i, i + CHUNK)
    const { data, error } = await client
      .from('chat_message_reactions')
      .select('message_id,user_id,emoji,created_at')
      .in('message_id', ids)
    if (error) throw error
    out.push(...((data || []) as ReactionRow[]))
  }
  return out
}

export async function toggleReaction(client: SupabaseClient, messageId: string, emoji: string): Promise<boolean> {
  const { data, error } = await client.rpc('toggle_chat_reaction', { p_message_id: messageId, p_emoji: emoji })
  if (error) throw error
  return data === true
}

export async function fetchPins(client: SupabaseClient, conversationId: string): Promise<PinRow[]> {
  const { data, error } = await client
    .from('chat_pinned_messages')
    .select('message_id,conversation_id,pinned_by,pinned_at')
    .eq('conversation_id', conversationId)
    .order('pinned_at', { ascending: false })
  if (error) throw error
  return (data || []) as PinRow[]
}

export async function setPinned(client: SupabaseClient, messageId: string, pinned: boolean): Promise<boolean> {
  const { data, error } = await client.rpc('set_chat_message_pinned', { p_message_id: messageId, p_pinned: pinned })
  if (error) throw error
  return data === true
}

export async function fetchChatProfiles(client: SupabaseClient): Promise<ChatProfile[]> {
  const { data, error } = await client
    .from('chat_profiles')
    .select('user_id,avatar_path,status_emoji,status_text,status_until')
  if (error) throw error
  return (data || []) as ChatProfile[]
}

export async function signAvatarUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (!unique.length) return {}
  const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(unique, SIGNED_SECONDS)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const item of data || []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl
  return out
}

export async function saveChatProfile(
  client: SupabaseClient,
  userId: string,
  patch: Partial<Omit<ChatProfile, 'user_id'>>,
): Promise<void> {
  const { error } = await client
    .from('chat_profiles')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
}

// Crops to a centred square, shrinks to the avatar size and re-encodes. That
// keeps the upload tiny and drops any location data stored in the photo.
export async function prepareAvatar(file: File, pixels: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const size = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = pixels
  canvas.height = pixels
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the picture.')
  ctx.drawImage(
    bitmap,
    Math.round((bitmap.width - size) / 2), Math.round((bitmap.height - size) / 2), size, size,
    0, 0, pixels, pixels,
  )
  bitmap.close?.()
  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88))
  if (!blob) throw new Error('Could not prepare the picture.')
  return blob
}

export async function uploadChatAvatar(client: SupabaseClient, userId: string, blob: Blob, previous: string | null): Promise<string> {
  const path = avatarPathFor(userId, Date.now(), avatarExtension(blob.type))
  const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: blob.type || 'image/webp', upsert: false })
  if (error) throw error
  if (previous && previous !== path) void client.storage.from(AVATAR_BUCKET).remove([previous]).catch(() => {})
  return path
}

export async function removeChatAvatar(client: SupabaseClient, path: string): Promise<void> {
  await client.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {})
}

export async function searchMessages(client: SupabaseClient, conversationId: string, query: string, limit = 30): Promise<SearchHit[]> {
  const q = cleanSearchQuery(query)
  if (q.length < 2) return []
  const { data, error } = await client
    .from('social_messages')
    .select('id,sender_id,body,created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .ilike('body', `%${escapeLike(q)}%`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []) as SearchHit[]
}

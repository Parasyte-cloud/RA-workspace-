import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mergeRoomMessages, newClientId } from './roomChatMerge'
import type { RoomChatMessage } from './roomChatMerge'

export type { RoomChatMessage } from './roomChatMerge'
export { mergeRoomMessages, newClientId } from './roomChatMerge'

const COLUMNS = 'id,room_id,sender_id,body,reply_to_id,client_message_id,created_at,edited_at,deleted_at'

// The saved chat of one ROOM 7. `active` is true while the chat is on screen:
// that is when messages count as read.
export function useRoomChat(roomId: string, myId: string, active: boolean) {
  const [messages, setMessages] = useState<RoomChatMessage[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unread, setUnread] = useState(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const namesRef = useRef(names)
  namesRef.current = names

  const loadNames = useCallback(async (ids: string[]) => {
    const client = supabase
    const need = Array.from(new Set(ids)).filter(id => id && !namesRef.current[id])
    if (!client || !need.length) return
    const { data } = await client.from('employee_profiles').select('id,full_name').in('id', need)
    if (!data) return
    setNames(current => {
      const next = { ...current }
      for (const row of data as { id: string; full_name: string | null }[]) next[row.id] = row.full_name || 'Colleague'
      return next
    })
  }, [])

  const load = useCallback(async () => {
    const client = supabase
    if (!client || !roomId) { setLoading(false); return }
    const { data, error: loadError } = await client
      .from('workspace_room_messages')
      .select(COLUMNS)
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(300)
    if (loadError) { setError(loadError.message); setLoading(false); return }
    const rows = ((data || []) as RoomChatMessage[]).slice().reverse()
    setError('')
    setMessages(current => mergeRoomMessages(current.filter(m => m.pending || m.failed), rows))
    void loadNames(rows.map(m => m.sender_id))
    setLoading(false)
  }, [roomId, loadNames])

  useEffect(() => {
    setMessages([]); setUnread(0); setLoading(true)
    void load()
  }, [load])

  // Live updates, plus a catch-up when the connection or the tab comes back.
  useEffect(() => {
    const client = supabase
    if (!client || !roomId) return
    const channel = client
      .channel(`room-chat-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'workspace_room_messages', filter: `room_id=eq.${roomId}` },
        payload => {
          const row = payload.new as RoomChatMessage
          setMessages(current => mergeRoomMessages(current, [row]))
          void loadNames([row.sender_id])
          if (row.sender_id !== myId && !activeRef.current) setUnread(count => count + 1)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'workspace_room_messages', filter: `room_id=eq.${roomId}` },
        payload => {
          const row = payload.new as RoomChatMessage
          setMessages(current => mergeRoomMessages(current, [row]))
        }
      )
      .subscribe(status => { if (status === 'SUBSCRIBED') void load() })
    const catchUp = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('online', catchUp)
    document.addEventListener('visibilitychange', catchUp)
    return () => {
      window.removeEventListener('online', catchUp)
      document.removeEventListener('visibilitychange', catchUp)
      void client.removeChannel(channel)
    }
  }, [roomId, myId, load, loadNames])

  useEffect(() => { if (active) setUnread(0) }, [active])

  const send = useCallback(async (body: string, replyTo: string | null = null, existingClientId?: string) => {
    const client = supabase
    const text = body.trim()
    if (!client || !text) return
    const clientId = existingClientId || newClientId()
    const tempId = `tmp-${clientId}`
    if (!existingClientId) {
      setMessages(current => mergeRoomMessages(current, [{
        id: tempId, room_id: roomId, sender_id: myId, body: text, reply_to_id: replyTo,
        client_message_id: clientId, created_at: new Date().toISOString(),
        edited_at: null, deleted_at: null, pending: true
      }]))
    } else {
      setMessages(current => current.map(m => m.id === tempId ? { ...m, pending: true, failed: false } : m))
    }
    const { data, error: sendError } = await client.rpc('send_room_message', {
      p_room: roomId, p_body: text, p_reply: replyTo, p_client: clientId
    })
    if (sendError || !data) {
      setMessages(current => current.map(m => m.id === tempId ? { ...m, pending: false, failed: true } : m))
      setError(sendError?.message || 'The message could not be sent.')
      return
    }
    setError('')
    // The saved row replaces the temporary one (same client id).
    setMessages(current => mergeRoomMessages(current.filter(m => m.id !== tempId), [data as RoomChatMessage]))
  }, [roomId, myId])

  const retry = useCallback((message: RoomChatMessage) => {
    if (!message.client_message_id) return
    void send(message.body, message.reply_to_id, message.client_message_id)
  }, [send])

  const edit = useCallback(async (id: string, body: string) => {
    const client = supabase
    if (!client) return
    const { error: editError } = await client.rpc('edit_room_message', { p_id: id, p_body: body })
    if (editError) { setError(editError.message); return }
    setMessages(current => current.map(m => m.id === id ? { ...m, body: body.trim(), edited_at: new Date().toISOString() } : m))
  }, [])

  const remove = useCallback(async (id: string) => {
    const client = supabase
    if (!client) return
    const { error: removeError } = await client.rpc('delete_room_message', { p_id: id })
    if (removeError) { setError(removeError.message); return }
    setMessages(current => current.map(m => m.id === id ? { ...m, body: 'Message deleted', deleted_at: new Date().toISOString() } : m))
  }, [])

  return { messages, names, loading, error, unread, send, retry, edit, remove, reload: load, clearError: () => setError('') }
}

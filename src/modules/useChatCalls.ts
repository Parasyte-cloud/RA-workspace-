import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upsertCall, type CallRecord } from '../lib/callLog'

const COLUMNS = 'id,conversation_id,caller_id,callee_id,room_code,kind,status,created_at,answered_at,ended_at'

/*
 * The signed-in person's recent calls, kept live. Feeds the call lines in the
 * chat thread, the "Missed call" preview in the chat list, and the Calls tab.
 * It also asks the database to close any call that rang out, so a call whose
 * caller closed their browser still turns into a missed call for everyone.
 */
export function useChatCalls(userId: string) {
  const [calls, setCalls] = useState<CallRecord[]>([])
  const loaded = useRef(false)

  useEffect(() => {
    const client = supabase
    if (!client || !userId) return
    let cancelled = false
    let channel: ReturnType<typeof client.channel> | null = null

    const sweep = async () => {
      if (document.visibilityState === 'hidden') return
      const { error } = await client.rpc('expire_chat_calls')
      // Before the SQL is run the function does not exist. Nothing to do.
      if (error) return
    }

    const load = async () => {
      await sweep()
      const { data, error } = await client
        .from('chat_calls')
        .select(COLUMNS)
        .order('created_at', { ascending: false })
        .limit(300)
      if (cancelled || error) return
      loaded.current = true
      setCalls((data || []) as CallRecord[])
    }

    void load()

    channel = client
      .channel(`chat-call-log-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_calls' }, payload => {
        const row = payload.new as CallRecord | undefined
        if (row && row.id) setCalls(current => upsertCall(current, row))
      })
      .subscribe()

    const timer = window.setInterval(() => void sweep(), 20_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) void client.removeChannel(channel)
    }
  }, [userId])

  return calls
}

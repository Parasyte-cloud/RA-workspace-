import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveCallId } from './activeCall'

type Row = { id: string; heartbeat_at?: string | null; answered_at?: string | null }

// Another phone or computer that is genuinely on the call keeps a fresh
// heartbeat, so a call beaten in the last 40 seconds is left alone.
const LIVE_MS = 75_000
// A call answered a moment ago has not sent its first heartbeat yet (the phone is
// still loading the call screen). Another device of the same person must not
// mistake that for a dead call and end it.
const NEW_CALL_MS = 120_000

/*
 * Ends answered calls this person is in that nothing is carrying any more: the
 * app was swiped away, the tab was closed, the phone lost signal. Until they
 * are ended, the database treats both people as "on another call" and turns
 * every new call into a missed call without ringing. Works before and after the
 * heartbeat SQL is run. Returns how many calls were ended.
 */
export async function endStaleCalls(client: SupabaseClient, me: string): Promise<number> {
  if (!me) return 0
  const wide = await client
    .from('chat_calls')
    .select('id,heartbeat_at,answered_at')
    .eq('status', 'accepted')
    .or(`caller_id.eq.${me},callee_id.eq.${me}`)
  let rows = (wide.data || []) as Row[]
  if (wide.error) {
    // The heartbeat column is not there yet (SQL not run): ask without it.
    const plain = await client
      .from('chat_calls')
      .select('id')
      .eq('status', 'accepted')
      .or(`caller_id.eq.${me},callee_id.eq.${me}`)
    if (plain.error) return 0
    rows = (plain.data || []) as Row[]
  }
  const active = getActiveCallId()
  const stale = rows.filter(row => {
    if (row.id === active) return false
    const beat = row.heartbeat_at ? Date.parse(row.heartbeat_at) : 0
    if (beat && Date.now() - beat < LIVE_MS) return false
    const answered = row.answered_at ? Date.parse(row.answered_at) : 0
    if (!beat && answered && Date.now() - answered < NEW_CALL_MS) return false
    return true
  })
  let ended = 0
  for (const row of stale) {
    const { error } = await client.rpc('respond_chat_call', { p_call: row.id, p_status: 'ended' })
    if (!error) ended += 1
  }
  return ended
}

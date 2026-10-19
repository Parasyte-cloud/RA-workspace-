import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { sendMessage } from '../chat/api/chatApi'
import { flushOutbox, loadOutbox } from '../lib/outbox'

export const OUTBOX_SENT = 'ra-outbox-sent'
export const OUTBOX_FAILED = 'ra-outbox-failed'
const CHECK_MS = 20_000

// Lives at the top of the workspace so waiting messages go out even when the
// person is on another page. It renders nothing.
export default function OutboxFlusher() {
  useEffect(() => {
    const client = supabase
    if (!client) return
    let alive = true
    let me = ''
    const run = async () => {
      if (!alive || !me || !loadOutbox(me).length) return
      await flushOutbox(me, {
        send: item => sendMessage({
          conversationId: item.conversationId,
          body: item.body,
          replyToId: item.replyToId,
          clientMessageId: item.clientMessageId,
          mentionedUserIds: item.mentionedUserIds,
        }),
        onSent: (item, message) => window.dispatchEvent(new CustomEvent(OUTBOX_SENT, { detail: { item, message } })),
        onFailed: (item, error) => window.dispatchEvent(new CustomEvent(OUTBOX_FAILED, { detail: { item, error } })),
      })
    }
    void client.auth.getUser().then(({ data }) => { me = data.user?.id || ''; void run() })
    const onVisible = () => { if (document.visibilityState === 'visible') void run() }
    const timer = window.setInterval(() => void run(), CHECK_MS)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}

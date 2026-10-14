import { supabase } from '../../lib/supabase'
import type {
  ChatMessage,
  SendMessageInput,
} from '../types'

export async function sendMessage(
  input: SendMessageInput,
): Promise<ChatMessage> {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  const { data, error } = await supabase.rpc(
    'send_chat_message',
    {
      p_conversation_id: input.conversationId,
      p_body: input.body,
      p_reply_to_id: input.replyToId ?? null,
      p_client_message_id: input.clientMessageId,
    },
  )

  if (error) {
    throw new Error(
      error.message || 'Unable to send message',
    )
  }

  if (!data) {
    throw new Error(
      'Message send returned no persisted message',
    )
  }

  return data as ChatMessage
}

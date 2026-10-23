import { supabase } from '../../lib/supabase'
import type {
  ChatMessage,
  SendMessageInput,
} from '../types'

function client() {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  return supabase
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<ChatMessage> {
  const mentionedUserIds =
    input.mentionedUserIds ?? []

  const request =
    mentionedUserIds.length > 0
      ? client().rpc(
          'send_chat_message_with_mentions',
          {
            p_conversation_id:
              input.conversationId,
            p_body: input.body,
            p_reply_to_id:
              input.replyToId ?? null,
            p_client_message_id:
              input.clientMessageId,
            p_mentioned_user_ids:
              mentionedUserIds,
          },
        )
      : client().rpc(
          'send_chat_message',
          {
            p_conversation_id:
              input.conversationId,
            p_body: input.body,
            p_reply_to_id:
              input.replyToId ?? null,
            p_client_message_id:
              input.clientMessageId,
          },
        )

  const { data, error } = await request

  if (error) {
    throw new Error(
      error.message ||
        'Unable to send message',
    )
  }

  if (!data) {
    throw new Error(
      'Message send returned no persisted message',
    )
  }

  return data as ChatMessage
}

export async function registerMessageMentions(
  messageId: string,
  mentionedUserIds: string[],
): Promise<void> {
  if (!mentionedUserIds.length) {
    return
  }

  const { error } = await client().rpc(
    'register_chat_message_mentions',
    {
      p_message_id: messageId,
      p_mentioned_user_ids:
        mentionedUserIds,
    },
  )

  if (error) {
    throw new Error(
      error.message ||
        'Unable to register message mentions',
    )
  }
}

export async function sendAttachmentMessage(input: {
  conversationId: string
  fileId: string
  body: string
  replyToId?: string | null
  clientMessageId: string
  durationMs?: number | null
}): Promise<ChatMessage> {
  const { data, error } = await client().rpc(
    'send_chat_attachment_message',
    {
      p_conversation_id: input.conversationId,
      p_file_id: input.fileId,
      p_body: input.body,
      p_reply_to_id: input.replyToId ?? null,
      p_client_message_id: input.clientMessageId,
      p_duration_ms: input.durationMs ?? null,
    },
  )

  if (error) throw new Error(error.message || 'Unable to send file message')
  if (!data) throw new Error('File message send returned no persisted message')
  return data as ChatMessage
}

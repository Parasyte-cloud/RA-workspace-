export type ChatMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  reply_to_id: string | null
  client_message_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export type ConversationKind =
  | 'direct'
  | 'department'
  | 'project'
  | 'committee'
  | 'restricted'

export type ConversationSummary = {
  id: string
  is_group: boolean
  title: string | null
  created_by: string
  created_at: string
  conversation_kind: ConversationKind
}

export type SendMessageInput = {
  conversationId: string
  body: string
  replyToId?: string | null
  clientMessageId: string
}

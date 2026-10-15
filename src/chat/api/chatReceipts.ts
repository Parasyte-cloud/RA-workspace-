import { supabase } from '../../lib/supabase'

export type ChatReceiptSummary = {
  message_id: string
  recipient_count: number
  delivered_count: number
  read_count: number
  delivered_by: string[]
  read_by: string[]
}

export type ChatReceiptState =
  | 'sent'
  | 'delivered'
  | 'read'

function client() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured',
    )
  }

  return supabase
}

function count(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? parsed
    : 0
}

function names(value: unknown) {
  return Array.isArray(value)
    ? value.map(String)
    : []
}

export function receiptState(
  summary:
    | ChatReceiptSummary
    | undefined,
  fallbackRead = false,
): ChatReceiptState {
  if (fallbackRead) return 'read'

  if (!summary) return 'sent'

  if (summary.read_count > 0) {
    return 'read'
  }

  if (summary.delivered_count > 0) {
    return 'delivered'
  }

  return 'sent'
}

export function receiptTitle(
  summary:
    | ChatReceiptSummary
    | undefined,
  isRoom: boolean,
  fallbackRead = false,
) {
  if (fallbackRead && !summary) {
    return 'Seen'
  }

  if (!summary) {
    return 'Sent'
  }

  const total =
    summary.recipient_count

  if (summary.read_count > 0) {
    const who =
      summary.read_by.join(', ')

    return isRoom
      ? `Seen by ${summary.read_count}/${total}${
          who ? `: ${who}` : ''
        }`
      : `Seen${
          who ? ` by ${who}` : ''
        }`
  }

  if (
    summary.delivered_count > 0
  ) {
    const who =
      summary.delivered_by.join(', ')

    return isRoom
      ? `Delivered to ${summary.delivered_count}/${total}${
          who ? `: ${who}` : ''
        }`
      : `Delivered${
          who ? ` to ${who}` : ''
        }`
  }

  return 'Sent'
}

export async function
ackChatDelivered(
  messageIds: string[],
): Promise<void> {
  const unique =
    Array.from(
      new Set(
        messageIds.filter(Boolean),
      ),
    )

  if (!unique.length) return

  const { error } =
    await client().rpc(
      'ack_chat_delivered',
      {
        p_message_ids: unique,
      },
    )

  if (error) throw error
}

export async function
ackChatRead(
  conversationId: string,
) {
  const { error } =
    await client().rpc(
      'ack_chat_read',
      {
        p_conversation_id:
          conversationId,
      },
    )

  if (error) throw error
}

export async function
listReceiptSummaries(
  conversationId: string,
): Promise<ChatReceiptSummary[]> {
  const { data, error } =
    await client().rpc(
      'chat_receipt_summary',
      {
        p_conversation_id:
          conversationId,
      },
    )

  if (error) throw error

  return (
    Array.isArray(data)
      ? data
      : []
  ).map((row: any) => ({
    message_id:
      String(row.message_id),

    recipient_count:
      count(row.recipient_count),

    delivered_count:
      count(row.delivered_count),

    read_count:
      count(row.read_count),

    delivered_by:
      names(row.delivered_by),

    read_by:
      names(row.read_by),
  }))
}

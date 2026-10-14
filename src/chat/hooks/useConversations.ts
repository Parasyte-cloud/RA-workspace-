import {
  useMemo,
  useState,
} from 'react'

type ConversationRow = {
  conversation: {
    id: string
  }
}

export function useConversations<
  T extends ConversationRow,
>(
  selectedId: string,
) {
  const [
    conversations,
    setConversations,
  ] = useState<T[]>([])

  const selected = useMemo(
    () =>
      conversations.find(
        row =>
          row.conversation.id === selectedId,
      ) || null,
    [
      conversations,
      selectedId,
    ],
  )

  return {
    conversations,
    setConversations,
    selected,
  }
}

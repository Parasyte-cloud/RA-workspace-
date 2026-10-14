import type {
  ConversationSummary,
} from '../types'

type DirectMessageListProps = {
  conversations: ConversationSummary[]
  selectedId?: string
  onSelect?: (conversationId: string) => void
}

export function DirectMessageList({
  conversations,
  selectedId,
  onSelect,
}: DirectMessageListProps) {
  if (!conversations.length) {
    return (
      <p className="chatEmptySmall">
        No direct messages yet.
      </p>
    )
  }

  return (
    <div>
      {conversations.map(conversation => (
        <button
          key={conversation.id}
          type="button"
          aria-current={
            conversation.id === selectedId
              ? 'page'
              : undefined
          }
          onClick={() =>
            onSelect?.(conversation.id)
          }
        >
          {conversation.title ||
            'Direct message'}
        </button>
      ))}
    </div>
  )
}

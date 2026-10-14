import type {
  ReactNode,
} from 'react'
import type {
  ConversationSummary,
} from '../types'
import {
  DirectMessageList,
} from './DirectMessageList'
import {
  RoomList,
} from './RoomList'

type ConversationSidebarProps = {
  children?: ReactNode
  rooms?: ConversationSummary[]
  directMessages?: ConversationSummary[]
  selectedId?: string
  onSelect?: (conversationId: string) => void
}

export function ConversationSidebar({
  children,
  rooms = [],
  directMessages = [],
  selectedId,
  onSelect,
}: ConversationSidebarProps) {
  return (
    <aside className="cmSide">
      {children ?? (
        <>
          <section>
            <div className="cmGroupLabel">
              Rooms
            </div>

            <RoomList
              rooms={rooms}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </section>

          <section>
            <div className="cmGroupLabel">
              Direct Messages
            </div>

            <DirectMessageList
              conversations={directMessages}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </section>
        </>
      )}
    </aside>
  )
}

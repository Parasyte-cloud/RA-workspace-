import { LoaderCircle, MessageSquareText } from 'lucide-react'
import { snippetAround } from '../messageSearch'
import type { SearchHit } from '../messageSearch'

/* Messages that match the sidebar search, from every chat the person can read. */
export default function MessageSearchResults({
  hits,
  query,
  loading,
  titleOf,
  senderOf,
  formatWhen,
  onOpen,
}: {
  hits: SearchHit[]
  query: string
  loading: boolean
  titleOf: (conversationId: string) => string
  senderOf: (id: string) => string
  formatWhen: (iso: string) => string
  onOpen: (hit: SearchHit) => void
}) {
  return (
    <div className="cmGroup">
      <div className="cmGroupLabel">Messages</div>
      {loading && hits.length === 0 && <div className="cmEmpty"><LoaderCircle size={15} className="cmSpin" /> Searching...</div>}
      {!loading && hits.length === 0 && <div className="cmEmpty">No messages match.</div>}
      {hits.map(hit => {
        const part = snippetAround(hit.body, query)
        return (
          <button key={hit.message_id} type="button" className="cmRow cmHit" onClick={() => onOpen(hit)}>
            <span className="cmHitIcon" aria-hidden="true"><MessageSquareText size={16} /></span>
            <span className="cmRowCopy">
              <span className="cmRowTop">
                <strong>{titleOf(hit.conversation_id)}</strong>
                <small>{formatWhen(hit.created_at)}</small>
              </span>
              <span className="cmRowBottom">
                <small>
                  <b>{senderOf(hit.sender_id)}:</b> {part.before}{part.match && <mark>{part.match}</mark>}{part.after}
                </small>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

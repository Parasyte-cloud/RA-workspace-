import { useEffect, useState } from 'react'
import { FileAudio, LoaderCircle } from 'lucide-react'
import { listSessions, formatClock, STATE_LABEL, type AiSession } from './api'

export default function Room7AiRecordsList({ onOpen, refreshKey = 0 }: { onOpen: (id: string) => void; refreshKey?: number }) {
  const [rows, setRows] = useState<AiSession[] | null>(null)
  useEffect(() => { void listSessions(12).then(setRows).catch(() => setRows([])) }, [refreshKey])
  if (rows === null) return <div className="roomRecentEmpty"><LoaderCircle size={16} className="roomSpin" /></div>
  if (rows.length === 0) return null
  return (
    <>
      <div className="roomSectionHeading compact">
        <div><span className="eyebrow"><FileAudio size={14} />R7 AI ASSISTANT</span><h3>AI meeting records</h3></div>
      </div>
      <div className="roomRecentGrid">
        {rows.map(s => (
          <article key={s.id} className="roomRecentCard">
            <FileAudio size={17} />
            <div>
              <strong>{s.title}</strong>
              <small>{new Date(s.started_at).toLocaleString()} · {s.duration_seconds ? formatClock(s.duration_seconds * 1000) : STATE_LABEL[s.state]}</small>
            </div>
            <div className="roomRecentActions">
              <button type="button" className="secondaryButton" onClick={() => onOpen(s.id)}>Open record</button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

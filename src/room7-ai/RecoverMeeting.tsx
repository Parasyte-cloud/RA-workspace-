import { useEffect, useState } from 'react'
import { LifeBuoy, LoaderCircle } from 'lucide-react'
import { recoverable, forgetSession } from './recorderStore'
import { finishSession } from './usePhysicalRecorder'

type Row = { sessionId: string; title: string; pending: number }

// Audio left behind by a reload, crash or dropped connection. One tap uploads
// it and produces the transcript, so a meeting is never lost to a refresh.
export default function RecoverMeeting({ onOpenRecord }: { onOpenRecord: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = () => recoverable().then(r => setRows(r.map(x => ({ sessionId: x.meta.sessionId, title: x.meta.title, pending: x.pending })))).catch(() => undefined)
  useEffect(() => { void load() }, [])

  async function recover(id: string) {
    setBusy(id); setNote('')
    try {
      const state = await finishSession(id, (p, left) => setNote(p === 'uploading' ? `Uploading ${left ?? 0} part(s)...` : p === 'transcribing' ? 'Making the transcript...' : ''))
      await load()
      if (state === 'ready') onOpenRecord(id)
      else setNote(state === 'incomplete_upload' ? 'Some audio parts are still missing. Try again on a stable connection.' : 'Could not finish yet. Your audio is still safe here. Try again.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not recover this meeting. Try again.')
    } finally {
      setBusy('')
    }
  }

  async function discard(id: string) {
    if (!window.confirm('Discard the saved audio for this meeting from this device? This cannot be undone.')) return
    await forgetSession(id)
    await load()
  }

  if (!rows.length) return null
  return (
    <div className="r7aiRecover">
      <LifeBuoy size={18} />
      <div>
        <strong>Recover physical meeting</strong>
        {rows.map(r => (
          <div className="r7aiRecoverRow" key={r.sessionId}>
            <span>{r.title}{r.pending ? ` · ${r.pending} part(s) not uploaded` : ''}</span>
            <button type="button" className="primaryButton" disabled={!!busy} onClick={() => void recover(r.sessionId)}>
              {busy === r.sessionId ? <LoaderCircle size={14} className="roomSpin" /> : null}Recover
            </button>
            <button type="button" className="secondaryButton" disabled={!!busy} onClick={() => void discard(r.sessionId)}>Discard</button>
          </div>
        ))}
        {note && <small>{note}</small>}
      </div>
    </div>
  )
}

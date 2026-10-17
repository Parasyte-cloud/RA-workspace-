import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CloudOff, Flag, LoaderCircle, Mic, NotebookPen, Pause, Play, Square, WifiOff } from 'lucide-react'
import { formatClock, loadSession, loadTranscript, type AiSegment, type AiSession } from './api'
import { usePhysicalRecorder } from './usePhysicalRecorder'
import type { StartedMeeting } from './PhysicalMeetingSetup'

export default function PhysicalMeetingRecorder({ meeting, onOpenRecord, onExit }: {
  meeting: StartedMeeting
  onOpenRecord: (id: string) => void
  onExit: () => void
}) {
  const r = usePhysicalRecorder({ sessionId: meeting.sessionId, title: meeting.title, live: meeting.live, deviceId: meeting.deviceId || undefined })
  const [segments, setSegments] = useState<AiSegment[]>([])
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [session, setSession] = useState<AiSession | null>(null)
  const started = useRef(false)
  const feed = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void r.start()
  }, [r])

  // Live text arrives by polling; the recorder never waits on it.
  useEffect(() => {
    if (!meeting.live || (r.phase !== 'recording' && r.phase !== 'paused')) return
    let stop = false
    const poll = async () => {
      try {
        const s = await loadSession(meeting.sessionId)
        if (!s || stop) return
        setSegments((await loadTranscript({ ...s, state: 'recording', processing_revision: 0 })).slice(-60))
      } catch { /* try again next tick */ }
    }
    void poll()
    const id = window.setInterval(poll, 4000)
    return () => { stop = true; window.clearInterval(id) }
  }, [meeting.live, meeting.sessionId, r.phase])

  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }) }, [segments.length])

  // After the meeting: wait for the transcript to finish.
  useEffect(() => {
    if (r.phase !== 'done' && r.phase !== 'transcribing') return
    let stop = false
    const poll = async () => { try { const s = await loadSession(meeting.sessionId); if (!stop && s) setSession(s) } catch { /* retry */ } }
    void poll()
    const id = window.setInterval(poll, 4000)
    return () => { stop = true; window.clearInterval(id) }
  }, [r.phase, meeting.sessionId])

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 2500) }
  const mark = async () => { try { await r.addMarker('important'); flash('Moment marked') } catch (e) { flash(e instanceof Error ? e.message : 'Could not mark that') } }
  const saveNote = async () => {
    if (!note.trim()) return
    try { await r.addMarker('note', note.trim()); setNote(''); setNoteOpen(false); flash('Note added') } catch (e) { flash(e instanceof Error ? e.message : 'Could not save the note') }
  }

  const recording = r.phase === 'recording'
  const paused = r.phase === 'paused'
  const after = ['stopping', 'uploading', 'transcribing', 'done'].includes(r.phase)
  const ready = session?.state === 'ready'
  const failed = r.phase === 'error' || session?.state === 'failed' || session?.state === 'incomplete_upload'

  return (
    <section className="r7aiPage r7aiRec responsiveModule">
      <div className="r7aiHead">
        <div>
          <span className="eyebrow">R7 AI ASSISTANT</span>
          <h2>{meeting.title}</h2>
        </div>
        <span className={`r7aiBadge ${recording ? 'live' : paused ? 'pause' : ''}`}>
          <i />{recording ? 'Recording' : paused ? 'Paused' : after ? 'Finishing' : r.phase === 'starting' ? 'Starting' : 'Stopped'}
        </span>
      </div>

      {r.problem === 'denied' && <div className="r7aiWarn"><AlertTriangle size={17} />Microphone access was blocked. Allow it in the browser settings and start again.</div>}
      {r.problem === 'missing' && <div className="r7aiWarn"><AlertTriangle size={17} />No microphone was found. Plug one in and start again.</div>}
      {r.problem === 'unsupported' && <div className="r7aiWarn"><AlertTriangle size={17} />This browser cannot record audio.</div>}
      {r.problem === 'lost' && <div className="r7aiWarn"><AlertTriangle size={17} />The microphone was disconnected. Recording is paused. Reconnect it and tap Resume.</div>}
      {!r.online && (recording || paused) && <div className="r7aiWarn"><WifiOff size={17} />Recording locally. Reconnecting. Nothing is lost; audio uploads when you are back online.</div>}
      {r.online && r.pendingUploads > 3 && (recording || paused) && <div className="r7aiNote"><CloudOff size={16} />Upload is {r.pendingUploads} parts behind. Recording continues.</div>}
      {r.bufferProblem && (recording || paused || r.phase === 'stopping' || r.phase === 'uploading') && <div className="r7aiNote">This device could not save a backup copy of the audio, so the recording is only safe while this page stays open. Keep ROOM 7 open until it says the upload is done.</div>}
      {meeting.live && !r.liveHealthy && (recording || paused) && <div className="r7aiNote">Live transcript is reconnecting. The recording is fine; the full transcript will be made after the meeting.</div>}

      {(recording || paused || r.phase === 'starting') && (
        <div className="r7aiCard glassCard r7aiConsole">
          <div className="r7aiClock" aria-live="off">{formatClock(r.elapsed)}</div>
          <div className="r7aiMeter big" aria-label="Microphone level"><i style={{ width: `${Math.round(r.level * 100)}%` }} /></div>
          <div className="r7aiControls">
            <button type="button" className="secondaryButton" onClick={() => void mark()} disabled={!recording && !paused}><Flag size={16} />Mark moment</button>
            <button type="button" className="secondaryButton" onClick={() => setNoteOpen(v => !v)} disabled={!recording && !paused}><NotebookPen size={16} />Add note</button>
            {recording
              ? <button type="button" className="secondaryButton" onClick={() => void r.pause()}><Pause size={16} />Pause</button>
              : <button type="button" className="secondaryButton" onClick={() => void r.resume()} disabled={!paused}><Play size={16} />Resume</button>}
            <button type="button" className="dangerButton" onClick={() => setConfirmEnd(true)}><Square size={16} />End meeting</button>
          </div>
          {noteOpen && (
            <div className="r7aiNoteBox">
              <textarea value={note} maxLength={2000} placeholder="Type a note for the record" onChange={e => setNote(e.target.value)} />
              <button type="button" className="primaryButton" onClick={() => void saveNote()} disabled={!note.trim()}>Save note</button>
            </div>
          )}
          <p className="r7aiKeepOpen"><AlertTriangle size={14} />Keep this screen open and awake while recording.</p>
        </div>
      )}

      {meeting.live && (recording || paused) && (
        <div className="r7aiCard glassCard">
          <div className="r7aiCardTitle"><Mic size={15} />Live transcript <small>rough text, improved after the meeting</small></div>
          <div className="r7aiFeed" ref={feed}>
            {segments.length === 0 ? <p className="r7aiEmpty">Listening. Text appears every few seconds.</p>
              : segments.map(s => <p key={s.id}><b>{formatClock(s.start_ms)}</b> {s.text}</p>)}
          </div>
        </div>
      )}

      {after && !failed && (
        <div className="r7aiCard glassCard r7aiDone">
          {ready ? (
            <>
              <h3>Your meeting record is ready</h3>
              <button type="button" className="primaryButton" onClick={() => onOpenRecord(meeting.sessionId)}>Open meeting record</button>
            </>
          ) : (
            <>
              <LoaderCircle size={26} className="roomSpin" />
              <h3>{r.phase === 'transcribing' || r.phase === 'done' ? 'Making your transcript' : r.phase === 'uploading' ? `Uploading the last ${r.pendingUploads} part(s)` : 'Wrapping up'}</h3>
              <p>You can leave this page once it says "Making your transcript". The record will be in ROOM 7 history.</p>
            </>
          )}
        </div>
      )}

      {failed && (
        <div className="r7aiCard glassCard r7aiDone">
          <AlertTriangle size={26} />
          <h3>Not finished yet</h3>
          <p>{r.message || session?.error_message || 'The transcript could not be completed. Your audio is safe; try again.'}</p>
          <button type="button" className="primaryButton" onClick={() => void r.retryFinish()}>Try again</button>
        </div>
      )}

      {(after || r.phase === 'error' || r.phase === 'idle') && <button type="button" className="secondaryButton r7aiBack" onClick={onExit}>Back to ROOM 7</button>}

      {confirmEnd && (
        <div className="r7aiConfirm" role="dialog" aria-modal="true" aria-label="End meeting">
          <div className="r7aiConfirmCard">
            <h3>End this meeting?</h3>
            <p>Recording stops and the transcript is made. This cannot be resumed.</p>
            <div className="r7aiConfirmActions">
              <button type="button" className="secondaryButton" onClick={() => setConfirmEnd(false)}>Keep recording</button>
              <button type="button" className="dangerButton" onClick={() => { setConfirmEnd(false); void r.end() }}>End meeting</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="r7aiToast" role="status">{toast}</div>}
    </section>
  )
}

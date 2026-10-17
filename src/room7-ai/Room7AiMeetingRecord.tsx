import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Copy, Download, LoaderCircle, Pencil, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  callFunction, formatClock, loadExtras, loadSession, loadTranscript, RETENTION_LABEL, rpc, speakerName, STATE_LABEL, transcriptText,
  type AiAttendee, type AiCorrection, type AiMarker, type AiSegment, type AiSession, type RetentionMode,
} from './api'

type Tab = 'overview' | 'transcript' | 'people' | 'audio' | 'export'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['transcript', 'Transcript'], ['people', 'People'], ['audio', 'Audio'], ['export', 'Export']]

export default function Room7AiMeetingRecord({ sessionId, myId, onBack }: { sessionId: string; myId: string; onBack: () => void }) {
  const [session, setSession] = useState<AiSession | null>(null)
  const [segments, setSegments] = useState<AiSegment[]>([])
  const [attendees, setAttendees] = useState<AiAttendee[]>([])
  const [markers, setMarkers] = useState<AiMarker[]>([])
  const [corrections, setCorrections] = useState<AiCorrection[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      const s = await loadSession(sessionId)
      if (!s) { setError('This meeting record was not found, or you do not have access to it.'); setLoading(false); return }
      const [segs, extras] = await Promise.all([loadTranscript(s), loadExtras(sessionId)])
      setSession(s); setSegments(segs); setAttendees(extras.attendees); setMarkers(extras.markers); setCorrections(extras.corrections)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this record.')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  // Keep checking while the transcript is still being made.
  useEffect(() => {
    if (!session || (session.state !== 'finalizing' && session.state !== 'recording' && session.state !== 'paused')) return
    const id = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(id)
  }, [session, load])

  const isHost = session?.started_by === myId
  const speakers = useMemo(() => [...new Set(segments.map(s => s.speaker_key))], [segments])
  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(''), 3000) }

  async function saveSpeaker(key: string) {
    if (!draft.trim()) return
    setBusy(true)
    try { await rpc('correct_ai_speaker', { p_session: sessionId, p_speaker_key: key, p_name: draft.trim() }); setEditing(''); setDraft(''); await load() }
    catch (e) { flash(e instanceof Error ? e.message : 'Could not save that name.') }
    finally { setBusy(false) }
  }

  async function changeRetention(mode: RetentionMode) {
    setBusy(true)
    try { await rpc('set_ai_retention', { p_session: sessionId, p_mode: mode }); await load(); flash('Audio policy updated') }
    catch (e) { flash(e instanceof Error ? e.message : 'Could not change that.') }
    finally { setBusy(false) }
  }

  async function retry(reprocess = false) {
    setBusy(true)
    try { await callFunction('room-ai-finalize', { session_id: sessionId, reprocess }); await load() }
    catch (e) { flash(e instanceof Error ? e.message : 'Could not restart processing.') }
    finally { setBusy(false) }
  }

  function download() {
    if (!session) return
    const blob = new Blob([transcriptText(session.title, segments, corrections)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${session.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'meeting'}-transcript.txt`
    document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); flash(`${what} copied`) } catch { flash('Copy is blocked in this browser.') }
  }

  if (loading) return <section className="r7aiPage"><LoaderCircle size={28} className="roomSpin" /></section>
  if (!session) return (
    <section className="r7aiPage">
      <button type="button" className="secondaryButton" onClick={onBack}><ArrowLeft size={15} />Back</button>
      <div className="r7aiWarn"><AlertTriangle size={17} />{error || 'Record not found.'}</div>
    </section>
  )

  const working = session.state === 'finalizing'
  const needsHelp = session.state === 'failed' || session.state === 'incomplete_upload'
  const duration = session.duration_seconds ? formatClock(session.duration_seconds * 1000) : '-'

  return (
    <section className="r7aiPage responsiveModule">
      <div className="r7aiHead">
        <div>
          <button type="button" className="secondaryButton" onClick={onBack}><ArrowLeft size={15} />ROOM 7</button>
          <h2>{session.title}</h2>
          <p>{new Date(session.started_at).toLocaleString()} · {duration} · {attendees.length} in the room · <span className={`r7aiState ${session.state}`}>{STATE_LABEL[session.state]}</span></p>
        </div>
        <span className="r7aiAccess"><ShieldCheck size={14} />Host and listed teammates only</span>
      </div>

      {working && <div className="r7aiNote"><LoaderCircle size={15} className="roomSpin" />The transcript is being made. This page updates by itself.</div>}
      {needsHelp && (
        <div className="r7aiWarn">
          <AlertTriangle size={17} /><span>{session.error_message || 'This record is not finished.'}</span>
          {isHost && !session.audio_deleted_at && <button type="button" className="primaryButton" disabled={busy} onClick={() => void retry()}><RefreshCw size={14} />Try again</button>}
        </div>
      )}
      {notice && <div className="r7aiToast" role="status">{notice}</div>}

      <div className="r7aiTabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'overview' && (
        <div className="r7aiCard glassCard">
          <h3>Summary</h3>
          {session.summary_text ? <p className="r7aiSummary">{session.summary_text}</p> : <p className="r7aiEmpty">{working ? 'The summary appears when the transcript is ready.' : 'No summary was produced for this meeting.'}</p>}
          {session.topics.length > 0 && <div className="r7aiChips">{session.topics.map(t => <span className="r7aiChip" key={t}>{t}</span>)}</div>}
          <h3>Marked moments and notes</h3>
          {markers.length === 0 ? <p className="r7aiEmpty">Nothing was marked.</p> : (
            <ul className="r7aiList">{markers.map(m => <li key={m.id}><b>{formatClock(m.at_ms)}</b> {m.kind === 'important' ? 'Important moment' : 'Note'}{m.body ? `: ${m.body}` : ''}</li>)}</ul>
          )}
          <p className="r7aiFine">Decisions and action items are not generated yet. When they are, they will be proposals that you review before any task is created.</p>
        </div>
      )}

      {tab === 'transcript' && (
        <div className="r7aiCard glassCard">
          {segments.length === 0 ? <p className="r7aiEmpty">{working ? 'The transcript appears when it is ready.' : 'No transcript yet.'}</p> : (
            <div className="r7aiTranscript">
              {segments.map(s => <p key={s.id}><span className="r7aiWho">{speakerName(s.speaker_key, corrections)}</span><b>{formatClock(s.start_ms)}</b> {s.text}</p>)}
            </div>
          )}
          {session.processing_revision > 0 && <p className="r7aiFine">Speaker names are a best guess. Rename them on the People tab; the original transcript is never changed.</p>}
        </div>
      )}

      {tab === 'people' && (
        <div className="r7aiCard glassCard">
          <h3>In the room</h3>
          <ul className="r7aiList">{attendees.map(a => <li key={a.seq}>{a.display_name}{a.user_id ? '' : ' (guest)'}</li>)}</ul>
          <h3>Speakers in the transcript</h3>
          {speakers.length === 0 ? <p className="r7aiEmpty">Speakers appear once the transcript is ready.</p> : (
            <ul className="r7aiList r7aiSpeakers">
              {speakers.map(k => (
                <li key={k}>
                  {editing === k ? (
                    <>
                      <input value={draft} maxLength={120} placeholder="Who is this?" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveSpeaker(k) }} list="r7aiNames" autoFocus />
                      <datalist id="r7aiNames">{attendees.map(a => <option key={a.seq} value={a.display_name} />)}</datalist>
                      <button type="button" className="primaryButton" disabled={busy || !draft.trim()} onClick={() => void saveSpeaker(k)}>Save</button>
                      <button type="button" className="secondaryButton" onClick={() => setEditing('')}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span>{speakerName(k, corrections)}</span>
                      <button type="button" className="secondaryButton" onClick={() => { setEditing(k); setDraft('') }}><Pencil size={13} />Rename</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'audio' && (
        <div className="r7aiCard glassCard">
          <h3>Recording</h3>
          {session.audio_deleted_at
            ? <p><Trash2 size={14} /> The audio was deleted on {new Date(session.audio_deleted_at).toLocaleString()}. The written record is kept.</p>
            : <p>Audio is stored privately and is not played back in the app. {session.delete_after ? `It will be deleted ${new Date(session.delete_after).toLocaleString()}.` : session.retention_mode === 'permanent' ? 'It is kept permanently.' : 'The deletion date is set once the transcript is ready.'}</p>}
          {isHost && !session.audio_deleted_at && (
            <div className="r7aiRadios">
              {(Object.keys(RETENTION_LABEL) as RetentionMode[]).map(m => (
                <label key={m}><input type="radio" name="ret" disabled={busy} checked={session.retention_mode === m} onChange={() => void changeRetention(m)} />{RETENTION_LABEL[m]}</label>
              ))}
            </div>
          )}
          {isHost && session.state === 'ready' && !session.audio_deleted_at && (
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => void retry(true)}><RefreshCw size={14} />Make the transcript again</button>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="r7aiCard glassCard">
          <h3>Export</h3>
          <div className="r7aiControls">
            <button type="button" className="primaryButton" onClick={download} disabled={segments.length === 0}><Download size={15} />Download transcript (.txt)</button>
            <button type="button" className="secondaryButton" onClick={() => void copy(session.summary_text || '', 'Summary')} disabled={!session.summary_text}><Copy size={15} />Copy summary</button>
          </div>
          <p className="r7aiFine">A branded PDF is coming. Exports follow the same access rule as this page.</p>
        </div>
      )}
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, Mic, Plus, ShieldCheck, X } from 'lucide-react'
import { listActiveEmployees, startPhysical, PHYSICAL_CONSENT_TEXT, RETENTION_LABEL, type RetentionMode } from './api'
import { listMicrophones, pickMime } from './usePhysicalRecorder'
import { recoverable } from './recorderStore'
import RecoverMeeting from './RecoverMeeting'

type Attendee = { name: string; user_id?: string }
export type StartedMeeting = { sessionId: string; title: string; live: boolean; deviceId: string }

const RETENTION_ORDER: RetentionMode[] = ['delete_after_finalize', 'days_7', 'days_30', 'days_90', 'permanent']

export default function PhysicalMeetingSetup({ onStarted, onCancel, onOpenRecord }: {
  onStarted: (m: StartedMeeting) => void
  onCancel: () => void
  onOpenRecord: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [newName, setNewName] = useState('')
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [mics, setMics] = useState<{ id: string; label: string }[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [micState, setMicState] = useState<'idle' | 'testing' | 'ok' | 'denied' | 'missing'>('idle')
  const [level, setLevel] = useState(0)
  const [consent, setConsent] = useState(false)
  const [retention, setRetention] = useState<RetentionMode>('delete_after_finalize')
  const [live, setLive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [leftovers, setLeftovers] = useState(0)
  const testStream = useRef<MediaStream | null>(null)
  const raf = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    void listActiveEmployees().then(setPeople).catch(() => undefined)
    void recoverable().then(r => setLeftovers(r.length)).catch(() => undefined)
    return stopTest
  }, [])

  function stopTest() {
    testStream.current?.getTracks().forEach(t => t.stop())
    testStream.current = null
    if (raf.current) cancelAnimationFrame(raf.current)
    void ctxRef.current?.close().catch(() => undefined)
    ctxRef.current = null
    setLevel(0)
  }

  async function testMic(id = deviceId) {
    stopTest()
    setMicState('testing'); setError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true } })
      testStream.current = s
      setMics(await listMicrophones())
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      ctxRef.current = ctx
      const an = ctx.createAnalyser(); an.fftSize = 512
      ctx.createMediaStreamSource(s).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = () => {
        raf.current = requestAnimationFrame(tick)
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const d = (v - 128) / 128; sum += d * d }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
      }
      raf.current = requestAnimationFrame(tick)
      setMicState('ok')
    } catch (e) {
      const name = (e as DOMException)?.name
      setMicState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'missing')
    }
  }

  function addPerson(p: Attendee) {
    const name = p.name.trim()
    if (!name || attendees.some(a => a.name.toLowerCase() === name.toLowerCase())) return
    setAttendees([...attendees, { ...p, name }])
  }

  const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickMime()
  const canStart = title.trim().length >= 2 && consent && micState === 'ok' && !busy && supported

  async function start() {
    setBusy(true); setError('')
    try {
      const label = mics.find(m => m.id === deviceId)?.label || mics[0]?.label || 'Default microphone'
      const id = await startPhysical({ title: title.trim(), attendees, retention, live, device: label })
      stopTest()
      onStarted({ sessionId: id, title: title.trim(), live, deviceId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the meeting.')
      setBusy(false)
    }
  }

  const unused = people.filter(p => !attendees.some(a => a.user_id === p.id))

  return (
    <section className="r7aiPage responsiveModule">
      <div className="r7aiHead">
        <div>
          <span className="eyebrow">R7 AI ASSISTANT</span>
          <h2>Start a physical meeting</h2>
          <p>This device records the room. The transcript is ready after the meeting, and live while you talk if you leave that on.</p>
        </div>
        <button type="button" className="secondaryButton" onClick={onCancel}><X size={15} />Close</button>
      </div>

      {leftovers > 0 && <RecoverMeeting onOpenRecord={onOpenRecord} />}

      {!supported && (
        <div className="r7aiWarn"><AlertTriangle size={17} />This browser cannot record audio. Use a recent Chrome, Edge, Safari or Firefox, and open ROOM 7 over https.</div>
      )}

      <div className="r7aiCard glassCard">
        <label className="r7aiField">
          <span>Meeting title</span>
          <input value={title} maxLength={120} placeholder="e.g. Management strategy meeting" onChange={e => setTitle(e.target.value)} />
        </label>

        <div className="r7aiField">
          <span>Who is in the room</span>
          <div className="r7aiChips">
            <span className="r7aiChip fixed">You (host)</span>
            {attendees.map(a => (
              <span className="r7aiChip" key={a.name}>
                {a.name}{a.user_id ? '' : ' (guest)'}
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttendees(attendees.filter(x => x !== a))}><X size={12} /></button>
              </span>
            ))}
          </div>
          <div className="r7aiAddRow">
            {unused.length > 0 && (
              <select value="" onChange={e => { const p = people.find(x => x.id === e.target.value); if (p) addPerson({ name: p.full_name, user_id: p.id }) }}>
                <option value="">Add a teammate</option>
                {unused.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            )}
            <input value={newName} maxLength={120} placeholder="Or type a guest's name" onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPerson({ name: newName }); setNewName('') } }} />
            <button type="button" className="secondaryButton" onClick={() => { addPerson({ name: newName }); setNewName('') }}><Plus size={14} />Add</button>
          </div>
          <small>Teammates you add can open the finished record. Guests are named in the transcript only.</small>
        </div>

        <div className="r7aiField">
          <span>Microphone</span>
          <div className="r7aiAddRow">
            {mics.length > 1 && (
              <select value={deviceId} onChange={e => { setDeviceId(e.target.value); void testMic(e.target.value) }}>
                {mics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            )}
            <button type="button" className="secondaryButton" onClick={() => void testMic()} disabled={micState === 'testing'}>
              {micState === 'testing' ? <LoaderCircle size={14} className="roomSpin" /> : <Mic size={14} />}
              {micState === 'ok' ? 'Test again' : 'Test microphone'}
            </button>
          </div>
          <div className="r7aiMeter" aria-label="Microphone level"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
          {micState === 'ok' && <small className="r7aiOk">Microphone working. Say something and watch the bar move.</small>}
          {micState === 'denied' && <small className="r7aiBad">Microphone access is blocked. Allow it in the browser's site settings, then test again.</small>}
          {micState === 'missing' && <small className="r7aiBad">No microphone was found. Plug one in or pick another, then test again.</small>}
          {micState === 'idle' && <small>Test the microphone before you start. It must work to begin.</small>}
        </div>

        <div className="r7aiField">
          <span>Transcript</span>
          <label className="r7aiSwitch">
            <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} />
            <span>Show a live transcript while we talk</span>
          </label>
          <small>{live ? 'Rough text appears every few seconds. A cleaner, speaker-labelled transcript replaces it after the meeting.' : 'Off: just record now. The full transcript is made after the meeting ends.'}</small>
        </div>

        <div className="r7aiField">
          <span>What happens to the audio</span>
          <div className="r7aiRadios">
            {RETENTION_ORDER.map(m => (
              <label key={m}><input type="radio" name="r7ret" checked={retention === m} onChange={() => setRetention(m)} />{RETENTION_LABEL[m]}</label>
            ))}
          </div>
          <small>The written record stays either way. Only the audio is removed.</small>
        </div>

        <label className="r7aiConsent">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          <span><ShieldCheck size={15} />{PHYSICAL_CONSENT_TEXT}</span>
        </label>

        <div className="r7aiKeepOpen"><AlertTriangle size={15} />Keep ROOM 7 open and the screen on while recording. Locking a phone or switching apps can stop the microphone.</div>

        {error && <div className="r7aiWarn">{error}</div>}

        <button type="button" className="primaryButton r7aiStart" disabled={!canStart} onClick={() => void start()}>
          {busy ? <LoaderCircle size={17} className="roomSpin" /> : <Mic size={17} />}Start meeting
        </button>
      </div>
    </section>
  )
}

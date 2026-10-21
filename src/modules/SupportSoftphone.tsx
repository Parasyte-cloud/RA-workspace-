import { useEffect, useMemo, useRef, useState } from 'react'
import { Delete, Headphones, Mic, MicOff, Phone, PhoneCall, PhoneIncoming, PhoneOff, Signal } from 'lucide-react'
import { RASupportSoftphone, type VoiceDeviceState, type VoiceQuality } from '../support/twilioVoice'
import { formatDuration, type SupportCall } from '../lib/supportCommandCentre'
import { useCelebrationBlocker } from '../celebrations/CelebrationBlockerContext'

export type DialRequest = { to: string; ticketId?: string; nonce: number }

type Props = {
  // The call TaskRouter is ringing this officer for, from the live calls view.
  // Twilio does not pass the customer's number to the browser on a dequeued call.
  ringing: SupportCall | null
  dialRequest: DialRequest | null
  onStateChange?: (state: VoiceDeviceState) => void
  voiceEnabled: boolean
}

const E164 = /^\+[1-9]\d{7,14}$/

function normalizeInput(value: string) {
  let v = value.trim().replace(/[\s()\-.]/g, '')
  if (v.startsWith('00')) v = '+' + v.slice(2)
  if (/^0\d{10}$/.test(v)) v = '+234' + v.slice(1)
  return v
}

export default function SupportSoftphone({ ringing, dialRequest, onStateChange, voiceEnabled }: Props) {
  const [deviceState, setDeviceState] = useState<VoiceDeviceState>('offline')
  const [notice, setNotice] = useState('')
  const [number, setNumber] = useState('')
  const [incoming, setIncoming] = useState(false)
  const [muted, setMuted] = useState(false)
  const [active, setActive] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [quality, setQuality] = useState<VoiceQuality | null>(null)
  useCelebrationBlocker('support_call', active)
  const phone = useRef<RASupportSoftphone | null>(null)
  const lastDial = useRef(0)

  useEffect(() => {
    const instance = new RASupportSoftphone({
      onState: (state, message) => { setDeviceState(state); onStateChange?.(state); if (message) setNotice(message) },
      onIncoming: (value) => setIncoming(Boolean(value)),
      onCall: (call) => { setActive(Boolean(call)); if (!call) { setMuted(false); setSeconds(0) } },
      onQuality: setQuality,
    })
    phone.current = instance
    return () => { instance.dispose(); phone.current = null }
    // onStateChange is intentionally read once; the instance lives as long as the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])

  const ready = deviceState === 'ready' || deviceState === 'incoming' || deviceState === 'on_call' || deviceState === 'connecting'
  const label = useMemo(() => deviceState.replace('_', ' '), [deviceState])

  const register = async () => {
    setNotice('')
    try { await phone.current?.register() }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to start the softphone.') }
  }

  const dial = async (to: string, ticketId?: string) => {
    const target = normalizeInput(to)
    if (!E164.test(target)) { setNotice('Enter a full international number, for example +2348012345678.'); return }
    setNotice('')
    try { await phone.current?.callNumber(target, ticketId) }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to place the call.') }
  }

  // "Call customer" buttons elsewhere in the workspace land here.
  useEffect(() => {
    if (!dialRequest || dialRequest.nonce === lastDial.current) return
    lastDial.current = dialRequest.nonce
    setNumber(dialRequest.to)
    if (ready && !active) void dial(dialRequest.to, dialRequest.ticketId)
    else if (!ready) setNotice('Start the softphone, then press Call.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialRequest])

  const digit = (value: string) => {
    if (active) phone.current?.sendDigits(value)
    else setNumber((current) => current + value)
  }

  if (!voiceEnabled) {
    return <section className="sccSoftphone" aria-label="Support softphone"><div className="sccSoftphoneTop"><div><span className="sccVoiceDot" /><strong>RA Voice</strong><small>Not enabled for your account</small></div></div></section>
  }

  return <section className="sccSoftphone" aria-label="Support softphone">
    <div className="sccSoftphoneTop">
      <div><span className={`sccVoiceDot ${ready ? 'ready' : ''}`} /><strong>RA Voice</strong><small>{label}{active ? ` ${formatDuration(seconds)}` : ''}</small></div>
      {!ready
        ? <button type="button" className="sccVoicePrimary" onClick={() => void register()} disabled={deviceState === 'registering'}><Headphones size={16} />{deviceState === 'registering' ? 'Connecting' : 'Start softphone'}</button>
        : <button type="button" onClick={() => void phone.current?.unregister()} disabled={active}><PhoneOff size={15} />Stop softphone</button>}
    </div>

    {quality && quality.level !== 'good'
      ? <div className={`sccQuality ${quality.level}`} role="status"><Signal size={14} />{quality.message}</div>
      : null}

    {incoming
      ? <div className="sccIncomingCall" role="alert">
        <PhoneIncoming size={20} />
        <div>
          <strong>{ringing?.direction === 'outbound' ? 'Callback' : 'Incoming support call'}{ringing?.public_id ? ` ${ringing.public_id}` : ''}</strong>
          <span>{ringing?.customer_name || ringing?.from_number || 'Customer number withheld'}{ringing?.priority ? ` · ${ringing.priority}` : ''}</span>
        </div>
        <button type="button" onClick={() => phone.current?.reject()} className="danger"><PhoneOff size={16} />Decline</button>
        <button type="button" onClick={() => phone.current?.accept()} className="sccVoicePrimary"><PhoneCall size={16} />Answer</button>
      </div>
      : null}

    <div className="sccDialRow">
      <div className="sccDialInput"><Phone size={16} /><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+234 801 234 5678" inputMode="tel" disabled={active} aria-label="Number to call" />{number && !active ? <button type="button" onClick={() => setNumber((v) => v.slice(0, -1))} aria-label="Delete digit"><Delete size={15} /></button> : null}</div>
      {!active
        ? <button type="button" className="sccVoicePrimary" onClick={() => void dial(number)} disabled={!ready}><PhoneCall size={16} />Call</button>
        : <>
          <button type="button" onClick={() => { const next = !muted; setMuted(next); phone.current?.mute(next) }}>{muted ? <MicOff size={16} /> : <Mic size={16} />} {muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" className="danger" onClick={() => phone.current?.hangup()}><PhoneOff size={16} />End</button>
        </>}
    </div>

    <div className="sccKeypad" aria-label="Dial keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((v) => <button type="button" key={v} onClick={() => digit(v)}>{v}</button>)}</div>
    {notice ? <div className="sccVoiceNotice" role="status">{notice}</div> : null}
  </section>
}

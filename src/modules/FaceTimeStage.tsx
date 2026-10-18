import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCcw,
  Video,
  Volume2,
  VideoOff
} from 'lucide-react'
import { RtkParticipantsAudio } from '@cloudflare/realtimekit-react-ui'
import type { useRealtimeKitClient } from '@cloudflare/realtimekit-react'
import '../facetime-call.css'

/*
 * One-to-one chat calls, drawn like FaceTime. It runs on the same
 * RealtimeKit connection as ROOM 7 but none of ROOM 7's meeting screen is
 * used: the other person fills the screen, your own camera is a small
 * window you can drag to any corner, and a floating pill holds the
 * controls. Voice calls get a large avatar instead of video.
 */

type Meeting = NonNullable<ReturnType<typeof useRealtimeKitClient>[0]>
type Corner = 'tl' | 'tr' | 'bl' | 'br'

type Remote = {
  id: string
  name?: string
  picture?: string
  audioEnabled: boolean
  videoEnabled: boolean
  videoTrack?: MediaStreamTrack
  on: (event: string, handler: () => void) => void
  removeListener: (event: string, handler: () => void) => void
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function TrackVideo({ track, mirror = false, className = '' }: { track?: MediaStreamTrack; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!track) { el.srcObject = null; return }
    el.srcObject = new MediaStream([track])
    void el.play().catch(() => {})
    return () => { el.srcObject = null }
  }, [track])
  return <video ref={ref} className={`ftVideo${mirror ? ' mirror' : ''} ${className}`} autoPlay playsInline muted />
}

function Avatar({ name, picture, big = false }: { name: string; picture?: string; big?: boolean }) {
  return (
    <span className={`ftAvatar${big ? ' big' : ''}`} aria-hidden="true">
      {picture ? <img src={picture} alt="" /> : initials(name)}
    </span>
  )
}

export default function FaceTimeStage({
  meeting,
  audioOnly,
  title,
  clock,
  minimized,
  onHangUp,
  onMinimize,
  onRestore,
  onJoinError
}: {
  meeting: Meeting
  audioOnly: boolean
  title: string
  clock: string
  minimized: boolean
  onHangUp: () => void
  onMinimize: () => void
  onRestore: () => void
  onJoinError: (message: string) => void
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [corner, setCorner] = useState<Corner>('br')
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [showControls, setShowControls] = useState(true)
  const [canFlip, setCanFlip] = useState(false)
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [speakerOpen, setSpeakerOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef(0)
  const joinError = useRef(onJoinError)
  joinError.current = onJoinError

  // Join as soon as the connection is ready. The classic screen waits for a
  // set-up page; a call goes straight in.
  useEffect(() => {
    if (meeting.self.roomJoined) return
    void meeting.join().catch((error: unknown) => {
      joinError.current(error instanceof Error ? error.message : 'Unable to join the call.')
    })
  }, [meeting])

  // Redraw when anyone's camera or microphone changes, or someone joins or leaves.
  useEffect(() => {
    const self = meeting.self
    const joined = meeting.participants.joined
    const redraw = () => bump()
    self.on('videoUpdate', redraw as never)
    self.on('audioUpdate', redraw as never)
    self.on('deviceUpdate', redraw as never)
    self.on('roomJoined', redraw as never)
    joined.on('participantJoined', redraw as never)
    joined.on('participantLeft', redraw as never)
    joined.on('participantsUpdate', redraw as never)
    return () => {
      self.removeListener('videoUpdate', redraw as never)
      self.removeListener('audioUpdate', redraw as never)
      self.removeListener('deviceUpdate', redraw as never)
      self.removeListener('roomJoined', redraw as never)
      joined.removeListener('participantJoined', redraw as never)
      joined.removeListener('participantLeft', redraw as never)
      joined.removeListener('participantsUpdate', redraw as never)
    }
  }, [meeting])

  const remotes = meeting.participants.joined.toArray() as unknown as Remote[]
  const remote = remotes[0]
  const remoteKey = remote?.id || ''
  useEffect(() => {
    if (!remote) return
    const redraw = () => bump()
    remote.on('videoUpdate', redraw)
    remote.on('audioUpdate', redraw)
    return () => {
      remote.removeListener('videoUpdate', redraw)
      remote.removeListener('audioUpdate', redraw)
    }
  }, [remote, remoteKey])

  useEffect(() => {
    let alive = true
    void meeting.self.getVideoDevices().then(list => { if (alive) setCanFlip(list.length > 1) }).catch(() => {})
    return () => { alive = false }
  }, [meeting])

  // Where the sound can go. Chrome, Edge and Android list the speaker, earpiece,
  // headset and Bluetooth; iPhone Safari does not let a page choose, iOS does.
  useEffect(() => {
    let alive = true
    const load = () => {
      void meeting.self.getSpeakerDevices().then(list => { if (alive) setSpeakers(list) }).catch(() => {})
    }
    load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => { alive = false; navigator.mediaDevices?.removeEventListener?.('devicechange', load) }
  }, [meeting])

  const self = meeting.self
  const audioOn = Boolean(self.audioEnabled)
  const videoOn = Boolean(self.videoEnabled)
  const remoteName = remote?.name || title
  const remoteVideoOn = Boolean(remote?.videoEnabled && remote?.videoTrack)
  const calling = !remote

  const toggleAudio = () => { void (audioOn ? self.disableAudio() : self.enableAudio()).then(() => bump()).catch(() => {}) }
  const toggleVideo = () => { void (videoOn ? self.disableVideo() : self.enableVideo()).then(() => bump()).catch(() => {}) }
  const currentSpeaker = self.getCurrentDevices().speaker
  const canPickOutput = speakers.length > 1
  const pickSpeaker = async (device: MediaDeviceInfo) => {
    try { await self.setDevice(device) } catch { /* the browser refused this output */ }
    setSpeakerOpen(false)
    bump()
  }
  const flip = async () => {
    try {
      const list = await self.getVideoDevices()
      if (list.length < 2) return
      const current = self.getCurrentDevices().video
      const index = list.findIndex(device => device.deviceId === current?.deviceId)
      await self.setDevice(list[(index + 1) % list.length])
      bump()
    } catch { /* no other camera */ }
  }

  // Controls fade out while the call is quiet, like FaceTime. A tap brings them back.
  const wake = useCallback(() => {
    setShowControls(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowControls(false), 4500)
  }, [])
  useEffect(() => {
    wake()
    return () => window.clearTimeout(hideTimer.current)
  }, [wake])

  // The small self window: drag it, and it settles into the nearest corner.
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const stage = stageRef.current
    if (!stage) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = stage.getBoundingClientRect()
    const move = (e: PointerEvent) => setDrag({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setCorner(`${y < rect.height / 2 ? 't' : 'b'}${x < rect.width / 2 ? 'l' : 'r'}` as Corner)
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const bigVideo = calling ? videoOn : remoteVideoOn
  const showSelfWindow = !calling && !audioOnly || (!calling && audioOnly && videoOn)
  const isVoice = audioOnly && !videoOn && !remoteVideoOn

  if (minimized) {
    return (
      <div className="ftStage ftMini" ref={stageRef} onClick={onRestore} role="button" aria-label="Return to call">
        <RtkParticipantsAudio meeting={meeting as never} />
        {bigVideo
          ? <TrackVideo track={calling ? self.videoTrack : remote?.videoTrack} mirror={calling} />
          : <div className="ftBackdrop"><Avatar name={remoteName} picture={remote?.picture} /></div>}
        <div className="ftMiniInfo"><strong>{remoteName}</strong><span>{calling ? 'Calling' : clock}</span></div>
      </div>
    )
  }

  return (
    <div className={`ftStage${isVoice ? ' ftVoice' : ''}${showControls ? ' ftShow' : ''}`} ref={stageRef} onClick={wake}>
      <RtkParticipantsAudio meeting={meeting as never} />

      {bigVideo
        ? <TrackVideo track={calling ? self.videoTrack : remote?.videoTrack} mirror={calling} />
        : (
          <div className="ftBackdrop">
            <Avatar name={remoteName} picture={remote?.picture} big />
            {!calling && !isVoice && <p className="ftNote"><VideoOff size={15} /> {remoteName} turned the camera off</p>}
          </div>
        )}

      <header className="ftTop">
        <button type="button" className="ftRound ftSmall" onClick={event => { event.stopPropagation(); onMinimize() }} aria-label="Minimize call" title="Minimize call">
          <ChevronDown size={20} />
        </button>
        <div className="ftWho">
          <strong>{remoteName}</strong>
          <span>{calling ? 'Calling…' : (audioOnly && !videoOn && !remoteVideoOn ? `Voice call · ${clock}` : clock)}</span>
        </div>
        <span className="ftSpacer" aria-hidden="true" />
      </header>

      {showSelfWindow && (
        <button
          type="button"
          className={`ftSelf ${drag ? 'dragging' : `corner-${corner}`}`}
          style={drag ? { left: drag.x, top: drag.y } : undefined}
          onPointerDown={startDrag}
          onClick={event => event.stopPropagation()}
          aria-label="Your camera. Drag to move."
        >
          {videoOn
            ? <TrackVideo track={self.videoTrack} mirror />
            : <span className="ftSelfOff"><Avatar name="You" /><small>Camera off</small></span>}
        </button>
      )}

      <div className="ftControls" onClick={event => event.stopPropagation()}>
        <button type="button" className={`ftRound${videoOn ? '' : ' off'}`} onClick={toggleVideo} aria-pressed={videoOn} aria-label={videoOn ? 'Turn camera off' : 'Turn camera on'}>
          {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
        </button>
        {canFlip && videoOn && (
          <button type="button" className="ftRound" onClick={() => void flip()} aria-label="Flip camera">
            <RefreshCcw size={21} />
          </button>
        )}
        <button type="button" className={`ftRound${speakerOpen ? ' active' : ''}`} onClick={() => setSpeakerOpen(open => !open)} aria-expanded={speakerOpen} aria-label="Speaker and sound output">
          <Volume2 size={22} />
        </button>
        <button type="button" className={`ftRound${audioOn ? '' : ' off'}`} onClick={toggleAudio} aria-pressed={audioOn} aria-label={audioOn ? 'Mute' : 'Unmute'}>
          {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
        </button>
        <button type="button" className="ftRound ftEnd" onClick={onHangUp} aria-label="End call">
          <PhoneOff size={24} />
        </button>
      </div>

      {speakerOpen && (
        <div className="ftSheetBack" onClick={event => { event.stopPropagation(); setSpeakerOpen(false) }}>
          <div className="ftSheet" role="dialog" aria-label="Sound output" onClick={event => event.stopPropagation()}>
            <strong>Sound output</strong>
            {canPickOutput
              ? speakers.map(device => (
                <button
                  key={device.deviceId}
                  type="button"
                  className={`ftChoice${device.deviceId === currentSpeaker?.deviceId ? ' on' : ''}`}
                  onClick={() => void pickSpeaker(device)}
                >
                  <Volume2 size={18} />
                  <span>{device.label || 'Speaker'}</span>
                </button>
              ))
              : (
                <p className="ftSheetNote">
                  This phone chooses where call sound plays. To switch between the earpiece, the loudspeaker and a headset, open Control Center (swipe down from the top right corner on iPhone), tap the audio card and pick the output. On Android, use the sound output button in the volume panel. Use the volume buttons to make the call louder.
                </p>
              )}
            <button type="button" className="ftSheetClose" onClick={() => setSpeakerOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

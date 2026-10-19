// Browser softphone built on the Twilio Voice JS SDK.
//
// What it guarantees
//  - one Device, one active call; a second incoming call while busy is rejected
//    (TaskRouter will offer it to someone else) rather than silently stacked
//  - the token is refreshed before it expires, so an officer on a long shift is
//    never silently deregistered
//  - the server is told when this browser stops being able to take calls
//    (unregistered, lost connection), because "Available" with a dead softphone
//    makes customers ring out
//  - network samples (latency, jitter, loss) are averaged and sent to the server
//    every 15 seconds, so the Head of Support sees call quality, not guesses
//  - network warnings (RTT, jitter, packet loss, low MOS) are surfaced as they
//    happen so an officer on a bad link can tell the customer before the call dies
//
// PArAsYtE | RA-Workspace support module

import { Device, type Call } from '@twilio/voice-sdk'
import { control, invokeSupport } from '../lib/supportCommandCentre'
import { QualityAccumulator } from './qualitySamples'

export type VoiceDeviceState = 'idle' | 'registering' | 'ready' | 'incoming' | 'connecting' | 'on_call' | 'error' | 'offline'

export type VoiceQuality = { level: 'good' | 'degraded' | 'poor'; message: string }

type Callbacks = {
  onState?: (state: VoiceDeviceState, message?: string) => void
  onIncoming?: (incoming: { call: Call; from: string } | null) => void
  onCall?: (call: Call | null) => void
  onQuality?: (quality: VoiceQuality | null) => void
}

// Edge order matters for West Africa: Europe first, then the US east coast.
// Override with VITE_TWILIO_EDGES="london,frankfurt" if your account has other edges.
function edges(): string[] {
  const raw = (import.meta.env?.VITE_TWILIO_EDGES as string | undefined) || 'frankfurt,dublin,ashburn'
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

const WARNING_TEXT: Record<string, string> = {
  'high-rtt': 'High latency on this connection',
  'high-jitter': 'Unstable connection (jitter)',
  'high-packet-loss': 'Packets are being lost',
  'high-packets-lost-fraction': 'Packets are being lost',
  'low-mos': 'Audio quality is low',
  'constant-audio-input-level': 'Your microphone may be muted or silent',
  'constant-audio-output-level': 'No audio is coming from the customer',
}

export class RASupportSoftphone {
  private device: Device | null = null
  private call: Call | null = null
  private incoming: Call | null = null
  private readonly cb: Callbacks
  private disposed = false
  private quality = new QualityAccumulator()
  private qualityTimer: ReturnType<typeof setInterval> | null = null

  constructor(callbacks: Callbacks = {}) {
    this.cb = callbacks
  }

  get activeCall() { return this.call }
  get pendingIncoming() { return this.incoming }
  get registered() { return this.device?.state === 'registered' }

  private state(state: VoiceDeviceState, message?: string) {
    if (!this.disposed) this.cb.onState?.(state, message)
  }

  private startQualityReporting(call: Call) {
    this.stopQualityReporting(call)
    this.quality = new QualityAccumulator()
    call.on('sample', (sample: { rtt?: number; jitter?: number; packetsLostFraction?: number }) => this.quality.add(sample))
    this.qualityTimer = setInterval(() => this.sendQuality(call), 15_000)
  }

  private sendQuality(call: Call) {
    const summary = this.quality.flush()
    const callSid = String(call.parameters?.CallSid || '')
    if (!summary || !callSid) return
    // Best effort. A lost sample must never disturb the call.
    void control({ action: 'quality_sample', callSid, rttMs: summary.rttMs, jitterMs: summary.jitterMs, lossPct: summary.lossPct }).catch(() => undefined)
  }

  private stopQualityReporting(call?: Call | null) {
    if (this.qualityTimer) clearInterval(this.qualityTimer)
    this.qualityTimer = null
    if (call) this.sendQuality(call)
  }

  private clearCall() {
    this.stopQualityReporting(this.call)
    this.call = null
    this.incoming = null
    this.cb.onIncoming?.(null)
    this.cb.onCall?.(null)
    this.cb.onQuality?.(null)
  }

  private bind(call: Call) {
    call.on('accept', () => { this.call = call; this.startQualityReporting(call); this.incoming = null; this.cb.onIncoming?.(null); this.cb.onCall?.(call); this.state('on_call') })
    call.on('disconnect', () => { this.clearCall(); this.state(this.registered ? 'ready' : 'offline') })
    call.on('cancel', () => { this.clearCall(); this.state('ready') })
    call.on('reject', () => { this.clearCall(); this.state('ready') })
    call.on('error', (e: { message?: string }) => this.state('error', e?.message || 'Call error'))
    call.on('warning', (name: string) => {
      this.cb.onQuality?.({ level: name === 'low-mos' || name === 'high-packet-loss' ? 'poor' : 'degraded', message: WARNING_TEXT[name] || 'Connection quality warning' })
    })
    call.on('warning-cleared', () => this.cb.onQuality?.({ level: 'good', message: 'Connection recovered' }))
  }

  private async token() {
    return invokeSupport<{ token: string; expiresAt: string; identity: string }>('support-voice-token', {})
  }

  async register() {
    this.state('registering')
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
      } catch {
        this.state('error', 'Microphone access is blocked. Allow the microphone for this site, then try again.')
        throw new Error('Microphone access is blocked.')
      }
    }
    const issued = await this.token()
    this.device?.destroy()
    const device = new Device(issued.token, {
      closeProtection: 'A call is in progress. Leaving this page will end it.',
      codecPreferences: ['opus', 'pcmu'] as unknown as Call.Codec[],
      edge: edges(),
      logLevel: 'error',
      maxCallSignalingTimeoutMs: 30_000,
    })
    this.device = device

    device.on('registered', () => {
      this.state('ready')
      void control({ action: 'register_device', registered: true }).catch(() => undefined)
    })
    device.on('unregistered', () => {
      if (!this.disposed) this.state('offline')
      void control({ action: 'register_device', registered: false }).catch(() => undefined)
    })
    device.on('error', (e: { message?: string }) => this.state('error', e?.message || 'Softphone error'))
    device.on('tokenWillExpire', () => {
      void this.token()
        .then((next) => device.updateToken(next.token))
        .catch((e) => this.state('error', e instanceof Error ? e.message : 'Voice token refresh failed'))
    })
    device.on('incoming', (call: Call) => {
      if (this.call || this.incoming) { call.reject(); return }
      this.incoming = call
      this.bind(call)
      this.cb.onIncoming?.({ call, from: String(call.parameters?.From || '') })
      this.state('incoming')
    })

    await device.register()
  }

  async unregister() {
    this.call?.disconnect()
    const device = this.device
    this.device = null
    if (device) {
      try { await device.unregister() } catch { /* already gone */ }
      device.destroy()
    }
    this.clearCall()
    this.state('offline')
  }

  dispose() {
    this.disposed = true
    void this.unregister()
  }

  async callNumber(to: string, ticketId?: string) {
    if (!this.device || !this.registered) throw new Error('Start the softphone first.')
    if (this.call) throw new Error('You are already on a call.')
    this.state('connecting')
    try {
      const call = await this.device.connect({ params: { To: to, ...(ticketId ? { TicketId: ticketId } : {}) } })
      this.bind(call)
      this.call = call
      this.cb.onCall?.(call)
      return call
    } catch (e) {
      this.state('ready')
      throw e
    }
  }

  accept() { this.incoming?.accept() }
  reject() { this.incoming?.reject() }
  hangup() { this.call?.disconnect() }
  mute(value: boolean) { this.call?.mute(value) }
  sendDigits(value: string) { this.call?.sendDigits(value) }
}

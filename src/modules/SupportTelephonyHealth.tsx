import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, Check, Voicemail, Wallet } from 'lucide-react'
import { control, formatDuration, label, loadTelephonyHealth, timeAgo, type FraudAlert, type TelephonyHealth } from '../lib/supportCommandCentre'

// Supervisor-only: line quality against the brief's targets, spend against the
// daily limits, and open fraud alerts. Polled slowly on its own timer because
// quality moves in minutes, not seconds.
const REFRESH_MS = 60_000

const ALERT_TEXT: Record<FraudAlert['kind'], (d: Record<string, unknown>) => string> = {
  call_burst: (d) => `${d.calls_last_hour} outbound calls in the last hour (limit ${d.limit})`,
  many_countries: (d) => `Dialled ${d.destinations_24h} different destinations in 24 hours`,
  short_call_burst: (d) => `${d.short_calls_10min} calls under 6 seconds in 10 minutes`,
  spend_alert: (d) => `Calling spend reached ${d.spend} today (alert at ${d.alert_at})`,
  spend_cap: (d) => `Daily spend cap reached: ${d.spend} of ${d.cap}. New outbound calls are blocked.`,
}

const money = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(2))

export default function SupportTelephonyHealth({ agentNames }: { agentNames: Map<string, string> }) {
  const [health, setHealth] = useState<TelephonyHealth | null>(null)
  const [alerts, setAlerts] = useState<FraudAlert[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { const r = await loadTelephonyHealth(); setHealth(r.health); setAlerts(r.alerts); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load telephony health.') }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const resolve = async (id: string) => {
    try { await control({ action: 'resolve_alert', alertId: id }); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not resolve that alert.') }
  }

  if (error && !health) return <div className="sccNotice">{error}</div>
  if (!health) return null

  const mosBad = health.avg_mos != null && health.avg_mos < 3.6
  const mosWarn = health.avg_mos != null && health.avg_mos < 4.0
  const capHit = health.spend_cap_daily != null && health.spend_today >= health.spend_cap_daily

  return <div className="sccPanel sccHealth">
    <div className="sccPanelTitle"><Activity size={17} /><strong>Line quality and spend</strong><small className="sccMuted">last 24 hours</small></div>
    <div className="sccMetrics six">
      <article className={mosBad ? 'bad' : ''}><Activity /><span>Avg MOS</span><strong>{health.avg_mos ?? '-'}</strong><small>{health.samples_24h} samples, target 4.0+{mosWarn && !mosBad ? ' (below target)' : ''}</small></article>
      <article><Activity /><span>Jitter / delay</span><strong>{health.avg_jitter_ms ?? '-'} ms</strong><small>RTT {health.avg_rtt_ms ?? '-'} ms, loss {health.avg_loss_pct ?? '-'}%</small></article>
      <article><Activity /><span>Outbound answered</span><strong>{health.outbound_asr == null ? '-' : `${health.outbound_asr}%`}</strong><small>{health.outbound_24h} calls, avg {health.outbound_acd_seconds == null ? '-' : formatDuration(health.outbound_acd_seconds)}</small></article>
      <article className={capHit ? 'bad' : ''}><Wallet /><span>Spend today</span><strong>{money(health.spend_today)}</strong><small>{health.spend_cap_daily != null ? `cap ${money(health.spend_cap_daily)}` : 'no cap set'}</small></article>
      <article className={health.open_fraud_alerts ? 'bad' : ''}><AlertTriangle /><span>Fraud alerts</span><strong>{health.open_fraud_alerts}</strong><small>open</small></article>
      <article><Voicemail /><span>Voicemails</span><strong>{health.voicemails_open}</strong><small>last 3 days awaiting callback</small></article>
    </div>
    {health.poor_samples_24h > 0 ? <p className="sccMuted sccHealthNote">{health.poor_samples_24h} poor-quality samples. Check the officer network or the carrier route before blaming the customer.</p> : null}
    {alerts.map((a) => <article className="sccAgent" key={a.id}>
      <div className={`sccPresence ${a.severity === 'critical' ? 'busy' : 'break'}`} />
      <span><b>{label(a.kind)}{a.agent_id ? ` · ${agentNames.get(a.agent_id) || 'officer'}` : ''}</b><small>{ALERT_TEXT[a.kind](a.detail)} · {timeAgo(a.created_at)}</small></span>
      <button type="button" className="sccIconBtn" onClick={() => void resolve(a.id)}><Check size={14} />Resolve</button>
    </article>)}
    {error ? <div className="sccNotice">{error}</div> : null}
  </div>
}

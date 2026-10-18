import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Wifi } from 'lucide-react'
import {
  formatBytes,
  formatDuration,
  loadMyDataStatus,
  rotateMyNetworkPassword,
  usageLevel,
  usagePercent,
  type MyDataStatus,
} from '../lib/dataAllocation'
import '../data-allocation.css'

// Shows a person their own daily data allowance and lets them create their own network
// password. Renders nothing at all until Administration has given them a plan, so people
// without one never see an empty or confusing card.
export default function MyDataCard() {
  const [status, setStatus] = useState<MyDataStatus | null>(null)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setStatus(await loadMyDataStatus())
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function newPassword() {
    setBusy(true)
    setError('')
    try {
      setPassword(await rotateMyNetworkPassword())
      setCopied(false)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a password.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (!status || !status.has_plan) return null

  const level = usageLevel(status.used_bytes, status.allowance_bytes)

  return (
    <article className="glassCard myData" aria-label="My data">
      <h4><Wifi size={15} /> My data today</h4>
      {status.status === 'suspended' ? (
        <p>Your data plan is suspended. Contact Administration.</p>
      ) : (
        <>
          <div className="myDataNumbers">
            <div><span>Left today</span><strong>{formatBytes(status.remaining_bytes)}</strong></div>
            <div><span>Used</span><strong>{formatBytes(status.used_bytes)}</strong></div>
            <div><span>Daily plan</span><strong>{status.tier_label}</strong></div>
          </div>
          <div className={`dataBar ${level}`} role="img" aria-label={`${usagePercent(status.used_bytes, status.allowance_bytes)}% used`}>
            <span style={{ width: `${usagePercent(status.used_bytes, status.allowance_bytes)}%` }} />
          </div>
          <small>Resets at midnight, in {formatDuration(status.resets_in_seconds)}. Unused data does not carry over.</small>
        </>
      )}
      {status.pool_exhausted && <p>The company data pool is empty right now. Administration has been told.</p>}

      <small>
        Office Wi-Fi sign-in: <strong>{status.username}</strong> with your network password.
      </small>
      {password ? (
        <div className="myDataPassword">
          <small>Your new network password. It is shown once, so copy it now.</small>
          <code>{password}</code>
          <button type="button" className="glassButton" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <button type="button" className="glassButton" onClick={() => void newPassword()} disabled={busy}>
          <KeyRound size={14} /> {status.has_password ? 'Create a new network password' : 'Create my network password'}
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </article>
  )
}

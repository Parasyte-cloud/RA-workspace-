import { Lock, Timer } from 'lucide-react'
import { choicesUpTo, viewLabel } from './vaultFormat'

type ButtonProps = {
  on: boolean
  disabled?: boolean
  onToggle: () => void
}

// The padlock beside the attach button. Pressing it makes the next message
// confidential.
export function LockButton({ on, disabled, onToggle }: ButtonProps) {
  return (
    <button
      type="button"
      className={`cmRound cmAttach cmVaultBtn${on ? ' on' : ''}`}
      title={on ? 'Confidential is on. Press to turn it off' : 'Send as confidential'}
      aria-label={on ? 'Confidential is on. Press to turn it off' : 'Send as confidential'}
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
    >
      <Lock size={19} />
    </button>
  )
}

type BarProps = {
  seconds: number
  ceiling: number
  onSeconds: (seconds: number) => void
  hasFiles: boolean
}

// Shown above the box while confidential is on: how long the other person can
// look once they open it.
export function LockBar({ seconds, ceiling, onSeconds, hasFiles }: BarProps) {
  const choices = choicesUpTo(ceiling)
  return (
    <div className="vcBar" role="group" aria-label="Confidential message">
      <span className="vcBarLabel"><Lock size={14} /> Confidential</span>
      <label className="vcBarTime">
        <Timer size={14} />
        <span>Visible for</span>
        <select value={seconds} onChange={event => onSeconds(Number(event.target.value))} aria-label="How long it stays visible once opened">
          {choices.map(choice => <option key={choice} value={choice}>{viewLabel(choice)}</option>)}
        </select>
      </label>
      <span className="vcBarHint">
        {hasFiles ? 'PDF files and images only. ' : ''}You get a one-time key to give them.
      </span>
    </div>
  )
}

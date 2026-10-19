import { useEffect, useState } from 'react'
import { Check, Copy, EyeOff, KeyRound } from 'lucide-react'

export type SheetKey = { label: string; key: string }

type Props = {
  title: string
  keys: SheetKey[]
  onDone: () => void
}

// Shows a one-time key once. When this sheet is closed the key is gone from
// this device. If it is lost, only an administrator can issue a new one.
export default function KeySheet({ title, keys, onDone }: Props) {
  const [copied, setCopied] = useState('')
  const [hidden, setHidden] = useState(false)

  // The key blurs the moment the person looks away from the screen.
  useEffect(() => {
    const hide = () => setHidden(true)
    const show = () => { if (document.visibilityState === 'visible') setHidden(false) }
    const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show())
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', hide)
    window.addEventListener('focus', show)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', hide)
      window.removeEventListener('focus', show)
    }
  }, [])

  const copy = async (item: SheetKey) => {
    try {
      await navigator.clipboard.writeText(item.key)
      setCopied(item.key)
      window.setTimeout(() => setCopied(current => (current === item.key ? '' : current)), 2500)
    } catch {
      setCopied('')
    }
  }

  return (
    <div className="ksOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ksPanel">
        <span className="ksIcon"><KeyRound size={26} /></span>
        <h3>{title}</h3>
        <p className="ksLead">
          This key is shown <strong>once</strong>. Give it to the person by voice or another channel,
          <strong> not in this chat</strong>. They need it to open the message, and it works one time.
        </p>
        {keys.map(item => (
          <div className="ksKeyBlock" key={item.key}>
            {keys.length > 1 && <span className="ksLabel">{item.label}</span>}
            <div className={`ksKey${hidden ? ' blurred' : ''}`} aria-label={hidden ? 'Key hidden' : `Key ${item.key.split('').join(' ')}`}>{item.key}</div>
            <button type="button" className="ksCopy" onClick={() => void copy(item)}>
              {copied === item.key ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy key</>}
            </button>
          </div>
        ))}
        {hidden && <p className="ksHidden"><EyeOff size={14} /> Hidden while you are away. Come back to see it.</p>}
        <p className="ksFoot">Lost it? Only an administrator can issue a new key.</p>
        <button type="button" className="ksDone" onClick={onDone}>I have saved it</button>
      </div>
    </div>
  )
}

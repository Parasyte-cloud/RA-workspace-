import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe, Mail, MapPin, Phone } from 'lucide-react'
import { LETTERHEAD } from '../lib/letterhead'
import './company-contact.css'

type Row = { id: string; label: string; value: string; icon: JSX.Element; href?: string }

const ROWS: Row[] = [
  { id: 'address', label: 'Address', value: LETTERHEAD.address, icon: <MapPin size={16} /> },
  { id: 'phone', label: 'Telephone', value: LETTERHEAD.phoneIntl, icon: <Phone size={16} />, href: `tel:${LETTERHEAD.phoneIntl.replace(/\s+/g, '')}` },
  { id: 'email', label: 'Email', value: LETTERHEAD.email, icon: <Mail size={16} />, href: `mailto:${LETTERHEAD.email}` },
  { id: 'web', label: 'Website', value: LETTERHEAD.website, icon: <Globe size={16} />, href: `https://${LETTERHEAD.website}` },
]

// Works over plain http and in browsers that block the async clipboard.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the older method */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

// Company contact details, one tap to copy each (or all of them together).
export default function CompanyContactCard() {
  const [copied, setCopied] = useState('')
  const [failed, setFailed] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  async function copy(id: string, text: string) {
    const ok = await copyText(text)
    setFailed(!ok)
    setCopied(ok ? id : '')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setCopied(''); setFailed(false) }, 2200)
  }

  const all = [LETTERHEAD.legalName, LETTERHEAD.address, `Tel: ${LETTERHEAD.phoneIntl}`, `Email: ${LETTERHEAD.email}`, LETTERHEAD.website].join('\n')

  return (
    <section className="ccCard" aria-label="Company contact details">
      <div className="ccHead">
        <div>
          <span className="ccEyebrow">Company details</span>
          <h3>{LETTERHEAD.legalName}</h3>
        </div>
        <button type="button" className="ccCopyAll" onClick={() => void copy('all', all)} aria-label="Copy all company details">
          {copied === 'all' ? <Check size={15} /> : <Copy size={15} />}
          {copied === 'all' ? 'Copied' : 'Copy all'}
        </button>
      </div>
      <ul className="ccList">
        {ROWS.map(row => (
          <li key={row.id}>
            <span className="ccIcon" aria-hidden="true">{row.icon}</span>
            <div className="ccText">
              <small>{row.label}</small>
              {row.href
                ? <a href={row.href} {...(row.id === 'web' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{row.value}</a>
                : <span>{row.value}</span>}
            </div>
            <button
              type="button"
              className={`ccCopy${copied === row.id ? ' done' : ''}`}
              onClick={() => void copy(row.id, row.value)}
              aria-label={copied === row.id ? `${row.label} copied` : `Copy ${row.label.toLowerCase()}`}
              title={`Copy ${row.label.toLowerCase()}`}
            >
              {copied === row.id ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <p className="ccStatus" role="status" aria-live="polite">
        {copied ? 'Copied to the clipboard.' : failed ? 'Copy is blocked in this browser. Select the text and copy it by hand.' : ''}
      </p>
    </section>
  )
}

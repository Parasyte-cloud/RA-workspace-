import { useEffect, useRef, useState } from 'react'
import { currentTheme, setTheme, tagLinks, type FormsTheme } from './formsTheme'
import { attachHeaderMove } from './headerMove'

/*
 * The homepage's header controls for the public forms: the main links, the
 * Services menu, the light / dark switch and a Book a ride button. Rendered
 * inside each page's <header className="formsHeader">; the stylesheet places
 * the pieces (logo left, links centre, badge and tools right) and swaps the
 * links for a menu button on narrow screens.
 */
const SERVICES = [
  { label: 'ArrivoExpress', href: 'https://express.ridearrivo.com' },
  { label: 'ArrivoRemovals', href: 'https://move.ridearrivo.com' },
  { label: 'ArrivoBoat', href: 'https://boat.ridearrivo.com' },
  { label: 'ArrivoAir', href: 'https://air.ridearrivo.com' },
  { label: 'Membership', href: 'https://membership.ridearrivo.com' },
]

const MAIN = [
  { label: 'How it works', href: 'https://www.ridearrivo.com/#how' },
  { label: "Who it's for", href: 'https://www.ridearrivo.com/#audiences' },
  { label: 'Safety', href: 'https://www.ridearrivo.com/#safety' },
]

export default function FormsHeaderNav() {
  const [theme, setThemeState] = useState<FormsTheme>(currentTheme())
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tagLinks(theme)
  })

  // Compact floating header: draggable, docks to a window edge as a vertical
  // pill. See headerMove.ts.
  useEffect(() => {
    const header = root.current?.closest('header')
    if (!(header instanceof HTMLElement)) return
    return attachHeaderMove(header)
  }, [])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setMenu(false)
      }
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function flip() {
    const next: FormsTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <div style={{ display: 'contents' }} ref={root}>
      <nav className="formsNav" aria-label="Primary">
        {MAIN.map((l) => (
          <a key={l.label} href={l.href}>{l.label}</a>
        ))}
        <div className="formsNavDrop">
          <button
            type="button"
            className="formsNavTrigger"
            aria-haspopup="true"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation()
              setOpen(!open)
            }}
          >
            Services <span aria-hidden="true">▾</span>
          </button>
          {open && (
            <ul className="formsNavMenu">
              {SERVICES.map((s) => (
                <li key={s.label}>
                  <a href={s.href}>{s.label}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>

      <div className="formsTools">
        <button type="button" className="formsThemeBtn" onClick={flip} aria-label={label} title={label}>
          <svg className="icoMoon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
          <svg className="icoSun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        </button>
        <a className="formsCta" href="https://www.ridearrivo.com/book.html">Book a ride</a>
        <button
          type="button"
          className="formsMenuBtn"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {menu && (
        <div className="formsMobilePanel">
          {MAIN.map((l) => (
            <a key={l.label} href={l.href}>{l.label}</a>
          ))}
          <span>Services</span>
          {SERVICES.map((s) => (
            <a key={s.label} href={s.href}>{s.label}</a>
          ))}
          <a href="https://www.ridearrivo.com/book.html">Book a ride</a>
          <a href="https://www.ridearrivo.com/login.html">Register or Login</a>
        </div>
      )}
    </div>
  )
}

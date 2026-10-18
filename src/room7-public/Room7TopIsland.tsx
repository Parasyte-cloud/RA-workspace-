import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Laptop, Moon, Sun, X } from 'lucide-react'
import { ROOM7_PRODUCTS, safeProductHref } from './room7Products'
import { useIslandScroll } from './useIslandScroll'
import type { Appearance } from './room7Theme'

/*
 * ROOM 7 top bar: a pill that sticks to the top, shrinks as the page scrolls
 * (iPhone Dynamic Island style), keeps ROOM 7 pinned on the right, and scrolls
 * the RideArrivo family past in the middle. Tapping a name opens a sheet that
 * lists every product with a link.
 */
export default function Room7TopIsland({
  pref,
  theme,
  onCycleTheme,
}: {
  pref: Appearance
  theme: 'light' | 'dark'
  onCycleTheme: () => void
}) {
  const island = useIslandScroll()
  const [open, setOpen] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  const ThemeIcon = pref === 'system' ? Laptop : theme === 'dark' ? Moon : Sun
  const label = pref === 'system' ? 'Auto' : pref === 'dark' ? 'Dark' : 'Light'

  return (
    <header className="r7Island" data-island={island} data-paused={open ? 'true' : 'false'}>
      <div className="r7IslandPill">
        <img className="r7IslandLogo" src="/parasyte-mark.png" alt="PArAsYtE" width={256} height={242} />

        <div className="r7IslandTicker" role="group" aria-label="The RideArrivo family">
          <div className="r7IslandTrack">
            {[0, 1].map(copy => (
              <ul key={copy} className="r7IslandRun" aria-hidden={copy === 1 ? 'true' : undefined}>
                {ROOM7_PRODUCTS.map(product => (
                  <li key={product.id}>
                    <button
                      type="button"
                      tabIndex={copy === 1 ? -1 : 0}
                      onClick={() => setOpen(product.id)}
                      aria-haspopup="dialog"
                    >
                      {product.name}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="r7IslandTheme"
          onClick={onCycleTheme}
          aria-label={`Appearance: ${label}. Tap to change.`}
          title={`Appearance: ${label}`}
        >
          <ThemeIcon size={15} />
        </button>

        <span className="r7IslandRoom">ROOM 7</span>
      </div>

      {open && createPortal(
        <div className="r7Sheet" data-theme={theme} role="presentation" onClick={() => setOpen(null)}>
          <div className="r7SheetCard" role="dialog" aria-modal="true" aria-label="The RideArrivo family" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <span>RIDEARRIVO</span>
                <h2>One family, every journey</h2>
              </div>
              <button ref={closeRef} type="button" onClick={() => setOpen(null)} aria-label="Close"><X size={18} /></button>
            </header>

            <ul>
              {ROOM7_PRODUCTS.map(product => {
                const href = safeProductHref(product.href)
                if (!href) return null
                return (
                  <li key={product.id} className={product.id === open ? 'picked' : ''}>
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      <span className="r7SheetName">{product.name}</span>
                      <span className="r7SheetLine">{product.line}</span>
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </a>
                  </li>
                )
              })}
            </ul>

            <footer>Links open in a new tab, so you keep your place in ROOM 7.</footer>
          </div>
        </div>,
        document.body,
      )}
    </header>
  )
}

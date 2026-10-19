import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placeBelow } from '../../lib/placePopover'
import type { Placement } from '../../lib/placePopover'
import './glass-popover.css'

/*
 * A menu that opens from a button as a liquid glass sheet.
 *
 * It is drawn in <body>, not next to the button. The old menus sat inside the
 * thread header, so message bubbles and other panes could paint over them. A
 * full-screen scrim blurs everything behind the sheet, and a tap on it, or
 * Escape, closes the menu.
 */

export default function GlassPopover({
  anchor,
  label,
  onClose,
  width = 300,
  children
}: {
  anchor: HTMLElement | null
  label: string
  onClose: () => void
  width?: number
  children: ReactNode
}) {
  const [place, setPlace] = useState<Placement | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    if (!anchor) { setPlace(null); return }
    const r = anchor.getBoundingClientRect()
    setPlace(placeBelow(r, { width: window.innerWidth, height: window.innerHeight }, width))
  }, [anchor, width])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current() }
    const away = () => close.current()
    window.addEventListener('keydown', key)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', away)
    }
  }, [])

  if (!place) return null
  return createPortal(
    <div className="cmGlassHost">
      <div className="cmGlassScrim" onClick={event => { event.stopPropagation(); onClose() }} />
      <div
        className="cmGlassMenu"
        role="menu"
        aria-label={label}
        style={{ top: place.top, left: place.left, width: place.width }}
        onClick={event => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

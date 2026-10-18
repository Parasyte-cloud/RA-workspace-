import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowDown, ArrowUp, Check, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { ISLAND_DEFAULT, ISLAND_MAX, ISLAND_MIN, cleanIsland, clampPos, isDoubleTap, moveIsland, posToPixels, readIsland, readPos, saveIsland, savePos, toggleIsland, type IslandPos } from '../lib/islandPrefs'

type NavItem = readonly [id: string, label: string, Icon: LucideIcon, ...rest: unknown[]]

export const ISLAND_IDS = ISLAND_DEFAULT

// A small floating pill for quick pages on laptops and iPads. The open page
// grows to show its name, like an iPhone Dynamic Island. People choose what
// sits in it. Only sections the person may already open can be picked (the
// list is filtered by App), so this never grants access.
export default function IslandNav({
  nav,
  section,
  onPick,
}: {
  nav: readonly NavItem[]
  section: string
  onPick: (id: string) => void
}) {
  const byId = useMemo(() => new Map(nav.map(item => [item[0], item] as const)), [nav])
  const valid = useMemo(() => new Set(nav.map(item => item[0])), [nav])
  const [chosen, setChosen] = useState<string[] | null>(() => readIsland())
  const [editing, setEditing] = useState(false)
  const [pos, setPos] = useState<IslandPos | null>(() => readPos())
  const [moving, setMoving] = useState(false)
  const [px, setPx] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLElement>(null)
  const lastTap = useRef(0)
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)

  // Turn the saved spot into pixels, and again whenever the window changes.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el || !pos) { setPx(null); return }
      const box = el.getBoundingClientRect()
      setPx(posToPixels(pos, box.width, box.height, window.innerWidth, window.innerHeight))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [pos, chosen])

  // Double tap anywhere on the bar to pick it up; drag it; tap Done (or Esc).
  const onDown = (event: ReactPointerEvent<HTMLElement>) => {
    const now = Date.now()
    if (moving) {
      if ((event.target as HTMLElement).closest('button')) return
      const box = ref.current!.getBoundingClientRect()
      drag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (isDoubleTap(lastTap.current, now)) { lastTap.current = 0; setMoving(true) } else lastTap.current = now
  }
  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    const el = ref.current
    if (!moving || !d || !el) return
    d.moved = true
    const box = el.getBoundingClientRect()
    const next = clampPos(event.clientX - d.dx, event.clientY - d.dy, box.width, box.height, window.innerWidth, window.innerHeight)
    setPos(next)
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (moving && d?.moved && pos) savePos(pos)
  }
  useEffect(() => {
    if (!moving) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoving(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving])

  const ids = useMemo(() => cleanIsland(chosen, valid), [chosen, valid])
  const update = (next: string[]) => { setChosen(next); saveIsland(next) }

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const items = ids.map(id => byId.get(id)).filter(Boolean) as NavItem[]
  if (items.length < 2) return null

  return (
    <>
      {editing && (
        <div className="raIslandLayer">
          <button type="button" className="raIslandScrim" aria-label="Close" onClick={() => setEditing(false)} />
          <div className="raIslandSheet" role="dialog" aria-label="Customise quick bar">
            <header>
              <strong>Customise quick bar</strong>
              <span>{ids.length} of {ISLAND_MAX}</span>
            </header>
            <p>Pick up to {ISLAND_MAX} pages (at least {ISLAND_MIN}). Use the arrows to reorder.</p>
            <div className="raIslandList">
              {ids.map((id, index) => {
                const item = byId.get(id)
                if (!item) return null
                const Icon = item[2]
                return (
                  <div key={id} className="raIslandRow on">
                    <Icon size={18} />
                    <span>{item[1]}</span>
                    <button type="button" aria-label={`Move ${item[1]} earlier`} disabled={index === 0} onClick={() => update(moveIsland(ids, id, -1))}><ArrowUp size={16} /></button>
                    <button type="button" aria-label={`Move ${item[1]} later`} disabled={index === ids.length - 1} onClick={() => update(moveIsland(ids, id, 1))}><ArrowDown size={16} /></button>
                    <button type="button" aria-label={`Remove ${item[1]}`} disabled={ids.length <= ISLAND_MIN} onClick={() => update(toggleIsland(ids, id, valid))}><Check size={16} /></button>
                  </div>
                )
              })}
              {nav.filter(item => !ids.includes(item[0]) && item[0] !== 'workspace').map(item => {
                const Icon = item[2]
                return (
                  <button key={item[0]} type="button" className="raIslandRow" disabled={ids.length >= ISLAND_MAX} onClick={() => update(toggleIsland(ids, item[0], valid))}>
                    <Icon size={18} />
                    <span>{item[1]}</span>
                  </button>
                )
              })}
            </div>
            <footer>
              <button type="button" className="raIslandReset" onClick={() => update(cleanIsland(null, valid))}>Reset</button>
              <button type="button" className="raIslandDone" onClick={() => setEditing(false)}>Done</button>
            </footer>
          </div>
        </div>
      )}
      <nav
        ref={ref}
        className={`raIsland${moving ? ' moving' : ''}${px ? ' placed' : ''}`}
        style={px ? { left: px.left, top: px.top, bottom: 'auto', transform: 'none' } : undefined}
        aria-label="Quick navigation"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {items.map(([id, label, Icon]) => {
          const on = section === id
          const name = label === 'Dashboard' ? 'Home' : label
          return (
            <button
              key={id}
              type="button"
              className={`raIslandBtn uiFocusRing${on ? ' on' : ''}`}
              aria-label={name}
              aria-current={on ? 'page' : undefined}
              title={name}
              onClick={() => { if (!moving) onPick(id) }}
            >
              <Icon size={19} />
              <span>{name}</span>
            </button>
          )
        })}
        {moving
          ? (
            <>
              <button type="button" className="raIslandBtn raIslandEdit uiFocusRing" aria-label="Put the bar back" title="Reset position" onClick={() => { setPos(null); savePos(null); setMoving(false) }}>
                <RotateCcw size={17} />
              </button>
              <button type="button" className="raIslandBtn raIslandDoneBtn uiFocusRing" onClick={() => setMoving(false)}>Done</button>
            </>
          )
          : (
            <button type="button" className="raIslandBtn raIslandEdit uiFocusRing" aria-label="Customise quick bar" title="Customise (double tap the bar to move it)" onClick={() => setEditing(true)}>
              <SlidersHorizontal size={17} />
            </button>
          )}
      </nav>
    </>
  )
}

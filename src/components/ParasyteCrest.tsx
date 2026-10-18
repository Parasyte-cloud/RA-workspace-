import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import '../parasyte-crest.css'

// The PArAsYtE crest: the metallic P mark with the wordmark. PArAsYtE is the major controller
// and engineering behind RideArrivo Workspace, so the crest is part of the product: a splash
// when the workspace opens, and a slim bar at the base of every screen.

export const PARASYTE_CREST_SRC = '/parasyte-wordmark-v2.png'
export const PARASYTE_CREDIT = 'Major controller and engineering'
export const PARASYTE_URL = 'https://www.parasyte.cloud'

const SPLASH_KEY = 'ra-parasyte-splash-seen'

function splashAlreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SPLASH_KEY) === '1'
  } catch {
    return false
  }
}

function rememberSplash() {
  try {
    window.sessionStorage.setItem(SPLASH_KEY, '1')
  } catch {
    /* private window: the splash simply shows again next time */
  }
}

const PILL_POS_KEY = 'ra-parasyte-pill-pos'
const DOUBLE_TAP_MS = 320

type PillPos = { x: number; y: number }

export function readPillPos(raw: string | null): PillPos | null {
  try {
    const value = JSON.parse(raw || 'null') as Partial<PillPos> | null
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return { x: Math.min(1, Math.max(0, Number(value.x))), y: Math.min(1, Math.max(0, Number(value.y))) }
    }
  } catch {
    /* ignore a damaged value */
  }
  return null
}

function loadPillPos(): PillPos | null {
  try { return readPillPos(window.localStorage.getItem(PILL_POS_KEY)) } catch { return null }
}

function savePillPos(pos: PillPos | null) {
  try {
    if (pos) window.localStorage.setItem(PILL_POS_KEY, JSON.stringify(pos))
    else window.localStorage.removeItem(PILL_POS_KEY)
  } catch {
    /* the position then lasts until the page closes */
  }
}

const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 599px)').matches === true

// Signature: the PArAsYtE wordmark, centered and alone, linking to parasyte.cloud with a gentle
// swell. Only the wordmark itself takes clicks, so the bar can never get in the way of the app.
//
// On a phone it can be moved: double tap it, drag it anywhere, double tap again (or tap
// elsewhere) to lock it. The place is remembered on this device. A single tap still opens
// parasyte.cloud, after a short wait to see whether a second tap follows.
export function ParasyteCrestBar() {
  const [pos, setPos] = useState<PillPos | null>(() => loadPillPos())
  const [moving, setMoving] = useState(false)
  const lastTap = useRef(0)
  const openTimer = useRef(0)
  const dragged = useRef(false)

  useEffect(() => {
    document.documentElement.classList.add('hasParasyteCrest')
    return () => document.documentElement.classList.remove('hasParasyteCrest')
  }, [])

  useEffect(() => () => window.clearTimeout(openTimer.current), [])

  // Tapping anywhere else locks it in place.
  useEffect(() => {
    if (!moving) return
    const lock = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('.parasyteCrestBar')) setMoving(false)
    }
    window.addEventListener('pointerdown', lock, true)
    return () => window.removeEventListener('pointerdown', lock, true)
  }, [moving])

  const onClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!isPhone()) return // desktop keeps the plain link
    event.preventDefault()
    if (dragged.current) { dragged.current = false; return }
    const now = Date.now()
    window.clearTimeout(openTimer.current)
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      setMoving(on => !on)
      return
    }
    lastTap.current = now
    if (moving) return // a single tap while moving does nothing
    openTimer.current = window.setTimeout(() => {
      window.open(PARASYTE_URL, '_blank', 'noopener,noreferrer')
    }, DOUBLE_TAP_MS)
  }, [moving])

  const onPointerDown = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (!moving) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragged.current = false
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (!moving || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    dragged.current = true
    const x = Math.min(0.96, Math.max(0.04, event.clientX / window.innerWidth))
    const y = Math.min(0.97, Math.max(0.03, event.clientY / window.innerHeight))
    setPos({ x, y })
  }

  const onPointerUp = () => {
    if (moving && pos) savePillPos(pos)
  }

  const reset = () => {
    setPos(null)
    savePillPos(null)
    setMoving(false)
  }

  const style = pos ? ({ '--pp-x': `${(pos.x * 100).toFixed(2)}vw`, '--pp-y': `${(pos.y * 100).toFixed(2)}dvh` } as CSSProperties) : undefined

  return (
    <footer
      className={`parasyteCrestBar${pos ? ' parasyteMoved' : ''}${moving ? ' parasyteMoving' : ''}`}
      style={style}
      aria-label="Engineered and controlled by PArAsYtE"
    >
      <a
        className="parasyteSignature"
        href={PARASYTE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="PArAsYtE: major controller and engineering. parasyte.cloud. On a phone, double tap to move it."
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img src={PARASYTE_CREST_SRC} alt="PArAsYtE" width={900} height={168} decoding="async" draggable={false} />
      </a>
      {moving && (
        <span className="parasyteMoveHint" role="status">
          Drag me anywhere. Double tap to lock.
          <button type="button" onClick={reset}>Reset</button>
        </span>
      )}
    </footer>
  )
}

// Opening sequence, once per browser session: PArAsYtE first, then the familiar RideArrivo
// load-up (logo and spinner) before the workspace appears. Tap, click or press any key to skip.
export function ParasyteSplash() {
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && !splashAlreadySeen())
  const [stage, setStage] = useState<'parasyte' | 'ridearrivo'>('parasyte')
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    rememberSplash()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const toLoadUp = window.setTimeout(() => setStage('ridearrivo'), reduced ? 1100 : 2000)
    const leave = window.setTimeout(() => setLeaving(true), reduced ? 1900 : 3400)
    return () => {
      window.clearTimeout(toLoadUp)
      window.clearTimeout(leave)
    }
  }, [visible])

  useEffect(() => {
    if (!leaving) return
    const done = window.setTimeout(() => setVisible(false), 500)
    return () => window.clearTimeout(done)
  }, [leaving])

  useEffect(() => {
    if (!visible) return
    const skip = () => setLeaving(true)
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [visible])

  if (!visible) return null

  return (
    <div
      className={`parasyteSplash${leaving ? ' leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={stage === 'parasyte' ? 'PArAsYtE' : 'Opening RideArrivo Workspace'}
      onClick={() => setLeaving(true)}
    >
      {stage === 'parasyte' ? (
        <div className="parasyteSplashInner" key="parasyte">
          <img className="parasyteSplashCrest" src={PARASYTE_CREST_SRC} alt="PArAsYtE" width={900} height={168} />
          <span className="parasyteSplashRule" aria-hidden="true" />
          <p className="parasyteSplashRole">{PARASYTE_CREDIT}</p>
          <p className="parasyteSplashProduct">RideArrivo Workspace</p>
        </div>
      ) : (
        <div className="parasyteSplashInner parasyteLoadUp" key="ridearrivo">
          <img className="parasyteLoadUpLogo" src="/ridearrivo-wordmark-workspace.png" alt="RideArrivo" draggable={false} />
          <div className="parasyteLoadUpSpinner" aria-hidden="true" />
        </div>
      )}
      <span className="parasyteSplashSkip">Tap to continue</span>
    </div>
  )
}

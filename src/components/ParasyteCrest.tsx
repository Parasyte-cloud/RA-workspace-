import { useEffect, useState } from 'react'
import '../parasyte-crest.css'

// The PArAsYtE crest: the metallic P mark with the wordmark. PArAsYtE is the major controller
// and engineering behind RideArrivo Workspace, so the crest is part of the product: a splash
// when the workspace opens, and a slim bar at the base of every screen.

export const PARASYTE_CREST_SRC = '/parasyte-crest.png'
export const PARASYTE_CREDIT = 'Major controller and engineering'

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

// Slim strip pinned to the bottom of every screen. It never takes clicks, so it cannot
// get in the way of the app underneath it.
export function ParasyteCrestBar() {
  useEffect(() => {
    document.documentElement.classList.add('hasParasyteCrest')
    return () => document.documentElement.classList.remove('hasParasyteCrest')
  }, [])

  return (
    <footer className="parasyteCrestBar" aria-label="Engineered and controlled by PArAsYtE">
      <span className="parasyteCrestCredit">Engineered and controlled by</span>
      <img src={PARASYTE_CREST_SRC} alt="PArAsYtE" width={764} height={132} decoding="async" />
    </footer>
  )
}

// Full-screen opening splash, once per browser session. Tap, click or press any key to skip.
export function ParasyteSplash() {
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && !splashAlreadySeen())
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    rememberSplash()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const showFor = window.setTimeout(() => setLeaving(true), reduced ? 1200 : 2600)
    return () => window.clearTimeout(showFor)
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
      aria-label="PArAsYtE"
      onClick={() => setLeaving(true)}
    >
      <div className="parasyteSplashInner">
        <img className="parasyteSplashCrest" src={PARASYTE_CREST_SRC} alt="PArAsYtE" width={764} height={132} />
        <span className="parasyteSplashRule" aria-hidden="true" />
        <p className="parasyteSplashRole">{PARASYTE_CREDIT}</p>
        <p className="parasyteSplashProduct">RideArrivo Workspace</p>
      </div>
      <span className="parasyteSplashSkip">Tap to continue</span>
    </div>
  )
}

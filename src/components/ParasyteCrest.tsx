import { useEffect, useState } from 'react'
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

// Signature at the base of every screen: the PArAsYtE wordmark, centered and alone, linking to
// parasyte.cloud with a gentle swell. Only the wordmark itself takes clicks, so the bar can never
// get in the way of the app underneath it.
export function ParasyteCrestBar() {
  useEffect(() => {
    document.documentElement.classList.add('hasParasyteCrest')
    return () => document.documentElement.classList.remove('hasParasyteCrest')
  }, [])

  return (
    <footer className="parasyteCrestBar" aria-label="Engineered and controlled by PArAsYtE">
      <a
        className="parasyteSignature"
        href={PARASYTE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="PArAsYtE: major controller and engineering. parasyte.cloud"
      >
        <img src={PARASYTE_CREST_SRC} alt="PArAsYtE" width={900} height={168} decoding="async" />
      </a>
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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import '../premium-celebration.css'

export type CelebrationIntensity = 'major' | 'birthday' | 'trophy' | 'seasonal_max'

export type PremiumCelebrationStageProps = {
  open: boolean
  intensity: CelebrationIntensity
  kicker: string
  title: string
  message?: string
  detail?: string
  photoUrl?: string | null
  icon?: ReactNode
  children?: ReactNode
  holdMs: number
  introMs: number
  onPresented?: () => void
  onClose: () => void
  staticVisuals?: boolean
}

const PIECE_COUNT = 108
const PALETTE = ['#ff9f1c', '#ffd166', '#f97316', '#ec4899', '#8b5cf6', '#3b82f6', '#22c55e', '#f8fafc']

export function PremiumCelebrationStage({
  open,
  intensity,
  kicker,
  title,
  message,
  detail,
  photoUrl,
  icon,
  children,
  holdMs,
  introMs,
  onPresented,
  onClose,
  staticVisuals = false,
}: PremiumCelebrationStageProps) {
  const [revealed, setRevealed] = useState(false)
  const presentationReported = useRef(false)
  const onPresentedRef = useRef(onPresented)
  const onCloseRef = useRef(onClose)
  const cardRef = useRef<HTMLElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  onPresentedRef.current = onPresented
  onCloseRef.current = onClose

  const pieces = useMemo(
    () => Array.from({ length: PIECE_COUNT }, (_, index) => ({
      id: index,
      left: (index * 47) % 101,
      delay: ((index * 19) % 38) / 20,
      duration: 3.8 + ((index * 31) % 38) / 10,
      drift: -42 + ((index * 23) % 85),
      spin: 240 + ((index * 71) % 720),
      width: 5 + ((index * 13) % 8),
      height: 14 + ((index * 17) % 19),
      color: PALETTE[index % PALETTE.length],
      layer: index % 3,
    })),
    [],
  )

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRevealed(false)
    presentationReported.current = false
    const presentationFrame = window.requestAnimationFrame(() => {
      closeButton.current?.focus()
      if (presentationReported.current) return
      presentationReported.current = true
      onPresentedRef.current?.()
    })
    const introTimer = window.setTimeout(() => setRevealed(true), introMs)
    const closeTimer = window.setTimeout(() => onCloseRef.current(), holdMs)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') || [])
          .filter(element => !element.hasAttribute('disabled'))
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(presentationFrame)
      window.clearTimeout(introTimer)
      window.clearTimeout(closeTimer)
      window.removeEventListener('keydown', onKeyDown)
      previousFocus.current?.focus()
    }
  }, [open, holdMs, introMs])

  if (!open) return null

  return (
    <div
      className={`premiumCelebrationOverlay premiumCelebration-${intensity}${revealed ? ' isRevealed' : ''}${staticVisuals ? ' isStaticVisuals' : ''}`}
      role="alertdialog"
      aria-modal="true"
      aria-label={`${kicker}: ${title}`}
      onMouseDown={event => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      {!staticVisuals && <div className="premiumCelebrationGlow" aria-hidden="true" />}
      {!staticVisuals && <div className="premiumCelebrationRibbons" aria-hidden="true">
        {pieces.map(piece => (
          <i
            key={piece.id}
            className={`premiumCelebrationPiece layer${piece.layer}`}
            style={{
              left: `${piece.left}%`,
              width: `${piece.width}px`,
              height: `${piece.height}px`,
              background: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              ['--celebration-drift' as string]: `${piece.drift}vw`,
              ['--celebration-spin' as string]: `${piece.spin}deg`,
            }}
          />
        ))}
        <span className="premiumCelebrationStreamer streamerA" />
        <span className="premiumCelebrationStreamer streamerB" />
        <span className="premiumCelebrationStreamer streamerC" />
        <span className="premiumCelebrationStreamer streamerD" />
      </div>}

      <section ref={cardRef} className="premiumCelebrationCard">
        <button ref={closeButton} type="button" className="premiumCelebrationClose" onClick={onClose} aria-label="Close celebration">
          <X size={18} />
        </button>
        <div className="premiumCelebrationIcon" aria-hidden="true">
          {photoUrl ? <img src={photoUrl} alt="" /> : icon}
        </div>
        <span className="premiumCelebrationKicker">{kicker}</span>
        <h2>{title}</h2>
        {message && <p className="premiumCelebrationMessage">{message}</p>}
        {detail && <strong className="premiumCelebrationDetail">{detail}</strong>}
        {children && <div className="premiumCelebrationBody">{children}</div>}
        <button type="button" className="premiumCelebrationDone" onClick={onClose}>Continue</button>
      </section>
    </div>
  )
}

export default PremiumCelebrationStage

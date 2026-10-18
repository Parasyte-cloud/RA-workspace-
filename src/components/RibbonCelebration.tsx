import { useEffect, useMemo } from 'react'
import { ribbonStyle } from '../lib/workReactions'
import type { RibbonKind } from '../lib/workReactions'
import '../work-reactions.css'

const CONFETTI = 64

export type CelebrationProps = {
  ribbon: { id: string; kind: RibbonKind; message: string } | null
  giverName: string
  task?: string
  onClose: () => void
  /** Show a person's photo in the medal (Golden of the Week). */
  photoUrl?: string | null
  /** Overrides for the small heading and the big title. */
  kicker?: string
  title?: string
  /** Show a "Say thanks" button. */
  onThanks?: () => void
  thanked?: boolean
  /** Stay on screen longer than the default. */
  holdMs?: number
}

// Full screen celebration. Golden gets the full show; the others are lighter.
export function WorkCelebration({ ribbon, giverName, task, onClose, photoUrl, kicker, title, onThanks, thanked, holdMs }: CelebrationProps) {
  useEffect(() => {
    if (!ribbon) return
    const timer = window.setTimeout(onClose, holdMs || (ribbon.kind === 'golden' ? 6500 : 4200) + (onThanks ? 3000 : 0))
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey) }
  }, [ribbon, onClose, holdMs, onThanks])

  const pieces = useMemo(() => {
    if (!ribbon) return []
    const count = ribbon.kind === 'golden' || ribbon.kind === 'rainbow' ? CONFETTI : 32
    return Array.from({ length: count }, (_, i) => ({
      left: Math.round(Math.random() * 100),
      delay: Math.round(Math.random() * 1400) / 1000,
      dur: 2200 + Math.round(Math.random() * 2000),
      size: 6 + Math.round(Math.random() * 8),
      spin: Math.round(Math.random() * 720 - 360),
      tone: i % 5,
      round: i % 3 === 0,
    }))
  }, [ribbon])

  if (!ribbon) return null
  const style = ribbonStyle(ribbon.kind)

  return (
    <div className={`wrxStage ${ribbon.kind}`} role="alertdialog" aria-label={`${title || style.label} received`} onClick={onClose}>
      <div className="wrxBurst" aria-hidden="true" />
      <div className="wrxConfetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i
            key={i}
            className={`t${p.tone}${p.round ? ' round' : ''}`}
            style={{
              left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 1.6,
              animationDelay: `${p.delay}s`, animationDuration: `${p.dur}ms`,
              ['--spin' as string]: `${p.spin}deg`,
            }}
          />
        ))}
      </div>
      <div className="wrxStreamer left" aria-hidden="true" />
      <div className="wrxStreamer right" aria-hidden="true" />
      <div className="wrxCard">
        <div className={`wrxMedal${photoUrl ? ' withPhoto' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 120 150" width="132" height="165">
            <defs>
              <linearGradient id="wrxGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--wrx-a)" />
                <stop offset=".5" stopColor="var(--wrx-b)" />
                <stop offset="1" stopColor="var(--wrx-c)" />
              </linearGradient>
            </defs>
            <path d="M34 70 L16 146 L42 132 L52 150 L66 78 Z" fill="var(--wrx-tail)" />
            <path d="M86 70 L104 146 L78 132 L68 150 L54 78 Z" fill="var(--wrx-tail2)" />
            <circle cx="60" cy="52" r="44" fill="url(#wrxGold)" />
            <circle cx="60" cy="52" r="35" fill="none" stroke="rgba(255,255,255,.65)" strokeWidth="2" />
            <circle cx="60" cy="52" r="30" fill="rgba(255,255,255,.14)" />
          </svg>
          {photoUrl
            ? <img className="wrxMedalPhoto" src={photoUrl} alt="" />
            : <span className="wrxMedalEmoji">{style.emoji}</span>}
          <span className="wrxShine" />
        </div>
        <p className="wrxKicker">{kicker || (ribbon.kind === 'golden' ? 'Golden buzzer' : 'Shout-out')}</p>
        <h2>{title || style.label}</h2>
        {giverName && <p className="wrxFrom">{giverName}</p>}
        {task && <p className="wrxTask">{task}</p>}
        {ribbon.message && <p className="wrxMessage">{ribbon.message}</p>}
        {onThanks && (
          <button
            type="button"
            className="wrxThanks"
            disabled={thanked}
            onClick={event => { event.stopPropagation(); onThanks() }}
          >
            {thanked ? 'Thanks sent' : 'Say thanks 🙏'}
          </button>
        )}
        <small className="wrxHint">Tap anywhere to close</small>
      </div>
    </div>
  )
}

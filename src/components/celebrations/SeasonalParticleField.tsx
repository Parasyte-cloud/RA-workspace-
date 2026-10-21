import type { CSSProperties } from 'react'
import type { CelebrationMotionProfile } from './useCelebrationMotionProfile'

type SeasonalParticleFieldProps = {
  profile: CelebrationMotionProfile
  fullCount: number
  balancedCount: number
  palette: readonly string[]
  symbols?: readonly string[]
  className?: string
}

export default function SeasonalParticleField({ profile, fullCount, balancedCount, palette, symbols = [''], className = '' }: SeasonalParticleFieldProps) {
  if (profile === 'reduced' || profile === 'static') return null
  const count = profile === 'full' ? fullCount : balancedCount
  const pieces = Array.from({ length: count }, (_, index) => ({
    id: index,
    left: (index * 37) % 101,
    delay: ((index * 17) % 41) / 20,
    duration: 4.2 + ((index * 29) % 44) / 10,
    drift: -38 + ((index * 23) % 77),
    rotate: 180 + ((index * 71) % 720),
    scale: 0.65 + ((index * 11) % 55) / 100,
    color: palette[index % palette.length],
    symbol: symbols[index % symbols.length],
  }))
  return <div className={`seasonalParticleField ${className}`} aria-hidden="true">
    {pieces.map(piece => <i key={piece.id} className="seasonalParticle" style={{
      left: `${piece.left}%`,
      color: piece.color,
      animationDelay: `${piece.delay}s`,
      animationDuration: `${piece.duration}s`,
      '--seasonal-drift': `${piece.drift}vw`,
      '--seasonal-rotate': `${piece.rotate}deg`,
      '--seasonal-scale': piece.scale,
    } as CSSProperties}>{piece.symbol}</i>)}
  </div>
}

import { useEffect, useState } from 'react'

export type CelebrationMotionProfile = 'full' | 'balanced' | 'reduced' | 'static'

type NavigatorWithHints = Navigator & {
  deviceMemory?: number
  connection?: { saveData?: boolean; effectiveType?: string }
}

function resolveProfile(): { profile: CelebrationMotionProfile; reason: string } {
  if (typeof window === 'undefined') return { profile: 'static', reason: 'server' }
  const nav = navigator as NavigatorWithHints
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return { profile: 'reduced', reason: 'reduced-motion' }
  if (nav.connection?.saveData) return { profile: 'static', reason: 'save-data' }
  if ((nav.deviceMemory ?? 8) <= 2) return { profile: 'static', reason: 'low-memory' }
  if ((nav.deviceMemory ?? 8) <= 4 || nav.connection?.effectiveType === '2g') return { profile: 'balanced', reason: 'constrained-device' }
  return { profile: 'full', reason: 'capable-device' }
}

export function useCelebrationMotionProfile() {
  const [value, setValue] = useState(resolveProfile)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const refresh = () => setValue(resolveProfile())
    query?.addEventListener?.('change', refresh)
    window.addEventListener('online', refresh)
    return () => {
      query?.removeEventListener?.('change', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [])
  return value
}

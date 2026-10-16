import { useEffect, useState } from 'react'
import { nextIslandState } from '../lib/islandBar'

// Page scroll -> 'full' at the top, 'compact' once scrolled (with hysteresis).
export function useIslandScroll(): 'full' | 'compact' {
  const [state, setState] = useState<'full' | 'compact'>('full')

  useEffect(() => {
    let current: 'full' | 'compact' = 'full'
    let frame = 0
    const read = () => {
      frame = 0
      const y = window.scrollY || document.documentElement.scrollTop || 0
      const next = nextIslandState(current, y)
      if (next !== current) { current = next; setState(next) }
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return state
}

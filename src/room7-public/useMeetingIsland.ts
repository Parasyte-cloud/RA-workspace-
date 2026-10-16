import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { nextIslandState } from '../lib/islandBar'
import { shouldIdleCompact } from './meetingIslandState'

type IslandState = 'full' | 'compact'

/*
 * The meeting's options bar behaves like an iPhone Dynamic Island: full size
 * while you are using the screen, a small pill when you scroll a panel or when
 * the screen has been still for a few seconds. It grows back on any touch,
 * movement or key press. Pure state; the look comes from CSS on
 * data-island.
 */
export function useMeetingIsland(
  shellRef: RefObject<HTMLElement | null>,
  options: { menuOpen?: boolean; active?: boolean } = {},
): IslandState {
  const [state, setState] = useState<IslandState>('full')
  const menuOpen = !!options.menuOpen
  const active = options.active !== false

  useEffect(() => {
    const shell = shellRef.current
    if (!active || !shell) return

    let scrollState: IslandState = 'full'
    let lastActive = Date.now()
    let overBar = false
    let frame = 0
    let timer = 0

    const publish = (scrolled: IslandState) => {
      scrollState = scrolled
      const idle = shouldIdleCompact({ idleMs: Date.now() - lastActive, overBar, menuOpen })
      setState(scrolled === 'compact' || idle ? 'compact' : 'full')
    }

    const onScroll = (event: Event) => {
      const el = event.target as HTMLElement | null
      if (!el || typeof el.scrollTop !== 'number') return
      // The bar itself and the video stage do not scroll the island.
      if (el.closest?.('.room7ExperienceChrome')) return
      if (frame) return
      const top = el.scrollTop
      frame = window.requestAnimationFrame(() => {
        frame = 0
        publish(nextIslandState(scrollState, top))
      })
    }

    const wake = () => {
      lastActive = Date.now()
      if (scrollState === 'full') publish('full')
      else setState((current: IslandState) => current)
    }
    const enter = () => { overBar = true; lastActive = Date.now(); publish(scrollState === 'compact' ? 'full' : scrollState) }
    const leave = () => { overBar = false; lastActive = Date.now() }

    const bar = shell.querySelector('.room7ExperienceChrome')
    shell.addEventListener('scroll', onScroll, { capture: true, passive: true })
    for (const name of ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin'] as const) {
      shell.addEventListener(name, wake, { passive: true })
    }
    bar?.addEventListener('pointerenter', enter)
    bar?.addEventListener('pointerleave', leave)
    bar?.addEventListener('focusin', enter)
    bar?.addEventListener('focusout', leave)

    timer = window.setInterval(() => publish(scrollState), 1000)

    return () => {
      shell.removeEventListener('scroll', onScroll, true)
      for (const name of ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin'] as const) {
        shell.removeEventListener(name, wake)
      }
      bar?.removeEventListener('pointerenter', enter)
      bar?.removeEventListener('pointerleave', leave)
      bar?.removeEventListener('focusin', enter)
      bar?.removeEventListener('focusout', leave)
      window.clearInterval(timer)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [shellRef, menuOpen, active])

  return state
}

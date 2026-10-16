import { useCallback, useEffect, useState } from 'react'

export type Appearance = 'system' | 'light' | 'dark'

// Same key the meeting screen already uses, so the choice follows the guest
// from the landing page into the call.
export const APPEARANCE_KEY = 'ridearrivo:room7:appearance'

export function parseAppearance(value: unknown): Appearance {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function resolveAppearance(pref: Appearance, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'light') return 'light'
  if (pref === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

// system -> light -> dark -> system. One tap cycles, like a phone toggle.
export function nextAppearance(pref: Appearance): Appearance {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
}

function readStored(): Appearance {
  try { return parseAppearance(localStorage.getItem(APPEARANCE_KEY)) } catch { return 'system' }
}

function readSystemDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return true }
}

export function useRoom7Appearance() {
  const [pref, setPref] = useState<Appearance>(readStored)
  const [systemDark, setSystemDark] = useState<boolean>(readSystemDark)

  useEffect(() => {
    let query: MediaQueryList
    try { query = window.matchMedia('(prefers-color-scheme: dark)') } catch { return }
    const update = () => setSystemDark(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  const set = useCallback((next: Appearance) => {
    setPref(next)
    try { localStorage.setItem(APPEARANCE_KEY, next) } catch { /* storage is optional */ }
  }, [])

  const theme = resolveAppearance(pref, systemDark)

  // The browser chrome (status bar, scrollbars, form controls) follows too.
  useEffect(() => {
    const root = document.documentElement
    root.style.colorScheme = theme
    root.dataset.room7Theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#07111f')
  }, [theme])

  return { pref, theme, setPref: set, cycle: () => set(nextAppearance(pref)) }
}

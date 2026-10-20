import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type BlockerContextValue = {
  blocked: boolean
  reasons: ReadonlySet<string>
  register: (reason: string, active: boolean) => void
}

const CelebrationBlockerContext = createContext<BlockerContextValue | null>(null)

export function CelebrationBlockerProvider({ children }: { children: ReactNode }) {
  const [reasons, setReasons] = useState<Set<string>>(() => new Set())
  const [documentHidden, setDocumentHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState !== 'visible')

  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState !== 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const register = useCallback((reason: string, active: boolean) => {
    if (!reason) return
    setReasons(current => {
      const next = new Set(current)
      active ? next.add(reason) : next.delete(reason)
      return next.size === current.size && [...next].every(value => current.has(value)) ? current : next
    })
  }, [])

  const value = useMemo<BlockerContextValue>(() => ({
    blocked: documentHidden || reasons.size > 0,
    reasons,
    register,
  }), [documentHidden, reasons, register])

  return <CelebrationBlockerContext.Provider value={value}>{children}</CelebrationBlockerContext.Provider>
}

export function useCelebrationBlocker(reason: string, active: boolean) {
  const context = useContext(CelebrationBlockerContext)
  useEffect(() => {
    context?.register(reason, active)
    return () => context?.register(reason, false)
  }, [context, reason, active])
}

export function useCelebrationIsBlocked() {
  return useContext(CelebrationBlockerContext)?.blocked ?? false
}

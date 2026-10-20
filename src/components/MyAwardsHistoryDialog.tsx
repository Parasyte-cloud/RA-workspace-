import { useCallback, useEffect, useRef, useState } from 'react'
import { Award, LoaderCircle, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

export type PersonalAward = {
  award_id: string
  category: string
  title: string
  description: string | null
  badge_code: string | null
  badge_label: string | null
  performance_month: string | null
  score: number | string | null
  awarded_at: string
  visibility: 'private' | 'company_recognition'
}

export const awardCategoryLabels: Record<string, string> = {
  monthly_kpi_excellence: 'Monthly KPI Excellence',
  annual_kpi_excellence: 'Annual KPI Excellence',
  golden_of_week: 'Golden of the Week',
  major_project_contribution: 'Major Project Contribution',
  clean_overdue_record: 'Clean Overdue Record',
  customer_commendation: 'Customer Commendation',
  team_commendation: 'Team Commendation',
  service_anniversary: 'Service Anniversary',
  training_compliance: 'Training & Compliance',
  identity_compliance_milestone: 'Identity Compliance Milestone',
  other: 'Recognition Award',
}

export function awardCategoryLabel(category: string) {
  return awardCategoryLabels[category] || category.replace(/_/g, ' ').replace(/\b\w/g, value => value.toUpperCase())
}

function awardDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MyAwardsHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<PersonalAward[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)

  const load = useCallback(async (before: string | null, append: boolean) => {
    if (!supabase) {
      setError('Awards are unavailable because the workspace is not configured.')
      return
    }
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    const { data, error: requestError } = await supabase.rpc('list_my_awards', {
      p_limit: 20,
      p_before: before,
    })
    if (requestError) {
      setError('Your awards could not be loaded. Please retry.')
    } else {
      const next = (data || []) as PersonalAward[]
      setRows(current => append ? [...current, ...next] : next)
      setHasMore(next.length === 20)
    }
    append ? setLoadingMore(false) : setLoading(false)
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void load(null, false)
    const timer = window.setTimeout(() => closeButton.current?.focus(), 0)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') || [])
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
    window.addEventListener('keydown', keydown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', keydown)
      previousFocus.current?.focus()
    }
  }, [open, load, onClose])

  if (!open) return null
  const last = rows[rows.length - 1]

  return (
    <div className="myAwardsDialogBackdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="myAwardsDialog" role="dialog" aria-modal="true" aria-labelledby="my-awards-dialog-title">
        <header className="myAwardsDialogHeader">
          <div>
            <span className="eyebrow">PRIVATE RECOGNITION HISTORY</span>
            <h2 id="my-awards-dialog-title">My Awards</h2>
            <p>Only you can see private KPI evidence and personal award details.</p>
          </div>
          <button ref={closeButton} type="button" className="myAwardsIconButton" aria-label="Close My Awards" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        {loading && <div className="myAwardsDialogState"><LoaderCircle className="myAwardsSpinner" size={22}/><span>Loading your awards...</span></div>}
        {!loading && error && <div className="myAwardsDialogState" role="alert"><span>{error}</span><button type="button" onClick={() => void load(null, false)}>Retry</button></div>}
        {!loading && !error && rows.length === 0 && <div className="myAwardsDialogState"><Award size={30}/><strong>No awards yet</strong><span>Your verified achievements will appear here.</span></div>}

        {!loading && !error && rows.length > 0 && (
          <div className="myAwardsHistoryList">
            {rows.map(row => (
              <article key={row.award_id} className="myAwardsHistoryItem">
                <div className="myAwardsMedallion" aria-hidden="true"><Award size={22}/></div>
                <div>
                  <span>{awardCategoryLabel(row.category)}</span>
                  <strong>{row.title}</strong>
                  {row.description && <p>{row.description}</p>}
                  <small>{awardDate(row.awarded_at)}{row.performance_month ? ` · ${awardDate(row.performance_month)}` : ''}</small>
                </div>
                {row.score !== null && <div className="myAwardsPrivateScore"><span>Private score</span><strong>{Math.round(Number(row.score))}%</strong></div>}
              </article>
            ))}
          </div>
        )}

        {!loading && !error && hasMore && last && (
          <button type="button" className="myAwardsLoadMore" disabled={loadingMore} onClick={() => void load(last.awarded_at, true)}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        )}
      </section>
    </div>
  )
}

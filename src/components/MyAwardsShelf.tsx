import { useCallback, useEffect, useState } from 'react'
import { Award, ChevronRight, LoaderCircle, RefreshCw, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import MyAwardsHistoryDialog, { awardCategoryLabel, type PersonalAward } from './MyAwardsHistoryDialog'
import '../my-awards.css'

function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export default function MyAwardsShelf({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const [awards, setAwards] = useState<PersonalAward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      setError('Awards are unavailable because the workspace is not configured.')
      return
    }
    setLoading(true)
    setError('')
    const { data, error: requestError } = await supabase.rpc('list_my_awards', { p_limit: 8, p_before: null })
    if (requestError) setError('Your awards could not be loaded.')
    else setAwards((data || []) as PersonalAward[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const openHistory = () => {
    if (onOpenHistory) onOpenHistory()
    else setHistoryOpen(true)
  }

  return (
    <>
      <section className="myAwardsShelf glassCard" aria-label="My Awards shelf">
        <header className="myAwardsShelfHeader">
          <div className="myAwardsTitle">
            <span className="myAwardsTitleIcon"><Trophy size={20}/></span>
            <div><span className="eyebrow">PRIVATE RECOGNITION</span><h3>My Awards</h3><p>Your verified achievements stay here after their ceremony.</p></div>
          </div>
          <span className="myAwardsCount" aria-label={`${awards.length} awards`}>{awards.length}</span>
        </header>

        {loading && <div className="myAwardsState"><LoaderCircle className="myAwardsSpinner" size={20}/><span>Preparing your awards shelf...</span></div>}
        {!loading && error && <div className="myAwardsState" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={15}/>Retry</button></div>}
        {!loading && !error && awards.length === 0 && <div className="myAwardsEmpty"><Award size={28}/><div><strong>No awards yet</strong><span>Your KPI, service and recognition awards will appear on this shelf.</span></div></div>}

        {!loading && !error && awards.length > 0 && (
          <div className="myAwardsRail" role="list" aria-label="Recent personal awards">
            {awards.map(row => (
              <article className="myAwardsCard" role="listitem" key={row.award_id}>
                <span className="myAwardsCardIcon" aria-hidden="true"><Award size={24}/></span>
                <span>{awardCategoryLabel(row.category)}</span>
                <strong>{row.title}</strong>
                <small>{shortDate(row.awarded_at)}</small>
              </article>
            ))}
          </div>
        )}

        <button type="button" className="myAwardsViewAll" onClick={openHistory}>
          View all awards <ChevronRight size={16}/>
        </button>
      </section>
      <MyAwardsHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)}/>
    </>
  )
}

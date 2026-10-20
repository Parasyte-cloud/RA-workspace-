import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Award, Crown, Flame, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as maybeSupabase } from '../lib/supabase'
import { resolveEmployeeAvatarUrl } from '../lib/employeeAvatar'
import { signAvatarUrls } from '../chat/api/chatExtras'
import { RIBBONS, ribbonStyle } from '../lib/workReactions'
import type { RibbonKind } from '../lib/workReactions'
import { flameTier, initialsOf, lagosWeekRange, ribbonCountLine, weekLabel } from '../lib/recognition'
import { WorkCelebration } from './RibbonCelebration'
import { DepartmentAchievementCeremony } from './DepartmentAchievementCeremony'
import PremiumCelebrationStage from './PremiumCelebrationStage'
import type { DepartmentAchievement } from './DepartmentAchievementCeremony'
import type { RibbonBudget } from './WorkReactions'
import '../work-reactions.css'
import '../recognition.css'

// The client is missing only when the app is not configured; entry points check first.
const supabase = maybeSupabase as NonNullable<typeof maybeSupabase>

/* ------------------------------------------------------------------ */
/* Golden of the Week, shared by every screen that shows the frame      */
/* ------------------------------------------------------------------ */

export type Champion = {
  user_id: string
  full_name: string
  job_title: string | null
  department: string | null
  headshot_path: string | null
  chat_avatar_path: string | null
  week_start: string
  score: number
  golden: number
  total: number
  streak: number
}

type ChampionState = { champion: Champion | null; photo: string | null; loaded: boolean }

const PHOTO_TTL_MS = 10 * 60 * 1000
let championState: ChampionState = { champion: null, photo: null, loaded: false }
let championAt = 0
let championBusy: Promise<void> | null = null
const championListeners = new Set<() => void>()

function publish(next: ChampionState) {
  championState = next
  championListeners.forEach(listener => listener())
}

async function refreshChampion(force = false): Promise<void> {
  if (!maybeSupabase) return
  if (!force && championState.loaded && Date.now() - championAt < PHOTO_TTL_MS) return
  if (championBusy) return championBusy
  championBusy = (async () => {
    const { data, error } = await supabase.rpc('current_ribbon_champion')
    if (error) { publish({ ...championState, loaded: true }); return }
    const row = (Array.isArray(data) ? data[0] : data) as Champion | undefined
    if (!row) { publish({ champion: null, photo: null, loaded: true }); championAt = Date.now(); return }
    let photo = await resolveEmployeeAvatarUrl(row.headshot_path)
    if (!photo && row.chat_avatar_path) {
      try {
        const signed = await signAvatarUrls(supabase as SupabaseClient, [row.chat_avatar_path])
        photo = signed[row.chat_avatar_path] || null
      } catch { photo = null }
    }
    championAt = Date.now()
    publish({ champion: row, photo, loaded: true })
  })().finally(() => { championBusy = null })
  return championBusy
}

export function useChampion(): ChampionState {
  const [, bump] = useState(0)
  useEffect(() => {
    const listener = () => bump(n => n + 1)
    championListeners.add(listener)
    void refreshChampion()
    return () => { championListeners.delete(listener) }
  }, [])
  return championState
}

export function useIsChampion(userId: string): boolean {
  const state = useChampion()
  return Boolean(userId && state.champion?.user_id === userId)
}

type FrameProps = { name: string; url?: string | null; size?: number; framed?: boolean }

// A round photo. With framed, it wears the golden Golden-of-the-Week frame.
export function ChampionAvatar({ name, url, size = 56, framed = false }: FrameProps) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  return (
    <span className={`champAvatar${framed ? ' framed' : ''}`} style={{ width: size, height: size }}>
      <span className="champPhoto">
        {url && !broken
          ? <img src={url} alt="" onError={() => setBroken(true)} />
          : <b style={{ fontSize: Math.round(size * 0.34) }}>{initialsOf(name)}</b>}
      </span>
      {framed && <span className="champCrown" aria-hidden="true"><Crown size={Math.max(12, Math.round(size * 0.24))} /></span>}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Streak flame                                                         */
/* ------------------------------------------------------------------ */

export function StreakBadge({ streak, compact = false }: { streak: number; compact?: boolean }) {
  const tier = flameTier(streak)
  if (!tier) return null
  return (
    <span className={`streakBadge ${tier}${compact ? ' compact' : ''}`} title={`${streak} on-time completions in a row`}>
      <Flame size={compact ? 13 : 16} />
      <b>{streak}</b>
      {!compact && <small>on time in a row</small>}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Dashboard: Hall of Fame                                              */
/* ------------------------------------------------------------------ */

type Leader = {
  user_id: string; full_name: string; department: string | null; chat_avatar_path: string | null
  total: number; golden: number; score: number; streak: number
}
type Award = {
  ribbon_id: string; source: string; recipient_id: string; kind: RibbonKind; message: string
  given_by: string; giver_name: string; created_at: string; task_title: string | null
}

export function HallOfFameCard() {
  const { champion, photo, loaded } = useChampion()
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [feed, setFeed] = useState<Award[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    if (!maybeSupabase) return
    const range = lagosWeekRange()
    const [board, awards] = await Promise.all([
      supabase.rpc('ribbon_leaderboard', { p_from: range.from, p_to: range.to, p_limit: 5 }),
      supabase.rpc('ribbon_awards', { p_user: null, p_from: range.from, p_to: range.to, p_limit: 6 }),
    ])
    const rows = (board.data || []) as Leader[]
    const recent = (awards.data || []) as Award[]
    setLeaders(rows)
    setFeed(recent)
    const ids = Array.from(new Set(recent.map(row => row.recipient_id)))
    if (ids.length) {
      const { data } = await supabase.from('employee_profiles').select('id,full_name,email').in('id', ids)
      const map: Record<string, string> = {}
      for (const p of (data || []) as Array<{ id: string; full_name: string; email: string }>) map[p.id] = p.full_name || p.email
      setNames(map)
    }
    const paths = rows.map(row => row.chat_avatar_path).filter((p): p is string => Boolean(p))
    if (paths.length) {
      try { setPhotos(await signAvatarUrls(supabase as SupabaseClient, paths)) } catch { /* initials are fine */ }
    }
    setReady(true)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!maybeSupabase) return
    let timer: number | null = null
    const channel = supabase
      .channel(`hall-of-fame-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_ribbons' }, () => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => { void load() }, 600)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ribbon_gifts' }, () => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => { void load() }, 600)
      })
      .subscribe()
    return () => { if (timer) window.clearTimeout(timer); void supabase.removeChannel(channel) }
  }, [load])

  if (!maybeSupabase || (!loaded && !ready)) return null
  if (!champion && leaders.length === 0 && feed.length === 0) {
    return (
      <article className="glassCard hofCard hofEmpty">
        <span className="eyebrow">HALL OF FAME</span>
        <p>No ribbons yet this week. When someone does great work, give them a ribbon and they will show up here.</p>
      </article>
    )
  }

  return (
    <article className="glassCard hofCard">
      <span className="eyebrow">HALL OF FAME</span>
      <div className="hofGrid">
        {champion && (
          <div className="hofSpotlight">
            <ChampionAvatar name={champion.full_name} url={photo} size={104} framed />
            <small className="hofKicker">GOLDEN OF THE WEEK</small>
            <strong>{champion.full_name}</strong>
            <span>{[champion.job_title, champion.department].filter(Boolean).join(' · ') || 'RideArrivo team'}</span>
            <em>{weekLabel(champion.week_start)}</em>
            <small>{ribbonCountLine(champion.total, champion.golden)}</small>
            <StreakBadge streak={champion.streak} />
          </div>
        )}

        <div className="hofBoard">
          <h4>This week so far</h4>
          {leaders.length === 0 && <p className="hofNone">Nobody has a ribbon yet this week.</p>}
          <ol>
            {leaders.map((leader, index) => (
              <li key={leader.user_id} className={champion?.user_id === leader.user_id ? 'isChamp' : ''}>
                <span className="hofPos">{index + 1}</span>
                <ChampionAvatar
                  name={leader.full_name}
                  url={leader.chat_avatar_path ? photos[leader.chat_avatar_path] : null}
                  size={34}
                  framed={champion?.user_id === leader.user_id}
                />
                <span className="hofName">
                  <b>{leader.full_name}</b>
                  <small>{ribbonCountLine(leader.total, leader.golden)}</small>
                </span>
                <StreakBadge streak={leader.streak} compact />
              </li>
            ))}
          </ol>

          {feed.length > 0 && (
            <>
              <h4>Latest ribbons</h4>
              <ul className="hofFeed">
                {feed.map(award => (
                  <li key={award.source + award.ribbon_id + award.recipient_id}>
                    <span aria-hidden="true">{ribbonStyle(award.kind).emoji}</span>
                    <span>
                      <b>{names[award.recipient_id] || 'A teammate'}</b> got a {ribbonStyle(award.kind).label} from {award.giver_name}
                      {award.message && <em>{award.message}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* My Profile: the trophy shelf                                         */
/* ------------------------------------------------------------------ */

export function RibbonWall({ userId, isSelf = false }: { userId: string; isSelf?: boolean }) {
  const [awards, setAwards] = useState<Award[]>([])
  const [weeks, setWeeks] = useState(0)
  const [streak, setStreak] = useState(0)
  const [budget, setBudget] = useState<RibbonBudget | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!maybeSupabase || !userId) return
    let live = true
    void (async () => {
      const [a, w, s] = await Promise.all([
        supabase.rpc('ribbon_awards', { p_user: userId, p_from: null, p_to: null, p_limit: 200 }),
        supabase.from('ribbon_champions').select('week_start').eq('user_id', userId),
        supabase.rpc('work_streak', { p_user: userId }),
      ])
      if (!live) return
      setAwards((a.data || []) as Award[])
      setWeeks((w.data || []).length)
      setStreak(typeof s.data === 'number' ? s.data : 0)
      if (isSelf) {
        const spent = await supabase.rpc('my_ribbon_budget')
        const row = Array.isArray(spent.data) ? spent.data[0] : spent.data
        if (live && row && (row.unlimited || row.golden_limit > 0)) setBudget(row as RibbonBudget)
      }
      setReady(true)
    })()
    return () => { live = false }
  }, [userId, isSelf])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    awards.forEach(award => map.set(award.kind, (map.get(award.kind) || 0) + 1))
    return map
  }, [awards])

  if (!ready) return null
  const left = budget && !budget.unlimited ? Math.max(0, budget.golden_limit - budget.golden_used) : null

  return (
    <section className="glassCard ribbonWall" aria-label="Ribbon wall">
      <div className="ribbonWallHead">
        <div>
          <span className="eyebrow">RIBBON WALL</span>
          <h3>{awards.length === 0 ? 'No ribbons yet' : `${awards.length} ribbon${awards.length === 1 ? '' : 's'} earned`}</h3>
        </div>
        <div className="ribbonWallBadges">
          {weeks > 0 && (
            <span className="weeksBadge" title="Weeks as Golden of the Week">
              <Crown size={15} />
              <b>{weeks}</b>
              <small>{weeks === 1 ? 'week as champion' : 'weeks as champion'}</small>
            </span>
          )}
          <StreakBadge streak={streak} />
        </div>
      </div>

      <div className="trophyShelf">
        {RIBBONS.map(style => {
          const n = counts.get(style.kind) || 0
          return (
            <div key={style.kind} className={`trophy ${style.kind}${n ? ' earned' : ''}`} title={`${style.label}: ${n}`}>
              <span className="trophyIcon" aria-hidden="true">{style.emoji}</span>
              <b>{n}</b>
              <small>{style.label.replace(' Ribbon', '')}</small>
            </div>
          )
        })}
      </div>

      {awards.length > 0 && (
        <ul className="wallList">
          {awards.slice(0, 6).map(award => (
            <li key={award.source + award.ribbon_id}>
              <span aria-hidden="true">{ribbonStyle(award.kind).emoji}</span>
              <span>
                <b>{ribbonStyle(award.kind).label}</b> from {award.giver_name}
                {award.task_title && <small> on {award.task_title}</small>}
                {award.message && <em>{award.message}</em>}
              </span>
              <time dateTime={award.created_at}>
                {new Date(award.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </time>
            </li>
          ))}
        </ul>
      )}

      {left !== null && (
        <p className="wallBudget">You can give {left} more golden ribbon{left === 1 ? '' : 's'} this month.</p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Ribbon picker for chat                                               */
/* ------------------------------------------------------------------ */

export function useCanGiveRibbon(): { canGive: boolean; budget: RibbonBudget | null } {
  const [canGive, setCanGive] = useState(false)
  const [budget, setBudget] = useState<RibbonBudget | null>(null)
  useEffect(() => {
    if (!maybeSupabase) return
    let live = true
    void (async () => {
      const give = await supabase.rpc('can_give_work_ribbon')
      if (!live || give.data !== true) return
      setCanGive(true)
      const spent = await supabase.rpc('my_ribbon_budget')
      const row = Array.isArray(spent.data) ? spent.data[0] : spent.data
      if (live && row) setBudget(row as RibbonBudget)
    })()
    return () => { live = false }
  }, [])
  return { canGive, budget }
}

type PickerProps = {
  title: string
  budget: RibbonBudget | null
  onSend: (kind: RibbonKind, message: string) => Promise<string | null>
  onClose: () => void
}

export function RibbonPicker({ title, budget, onSend, onClose }: PickerProps) {
  const [kind, setKind] = useState<RibbonKind>('star')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const left = budget && !budget.unlimited ? Math.max(0, budget.golden_limit - budget.golden_used) : null

  async function send() {
    setBusy(true)
    setError('')
    const problem = await onSend(kind, message.trim())
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }

  return (
    <div className="wrxModal" role="dialog" aria-label="Give a ribbon" onClick={onClose}>
      <div className="wrxModalCard" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h3>{title}</h3>
            <p>It shows on the Hall of Fame and they get a gift to unwrap.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="wrxKinds">
          {RIBBONS.map(r => (
            <button
              key={r.kind}
              type="button"
              className={`wrxKind ${r.kind}${kind === r.kind ? ' on' : ''}`}
              aria-pressed={kind === r.kind}
              disabled={r.kind === 'golden' && left === 0}
              onClick={() => setKind(r.kind)}
            >
              <span aria-hidden="true">{r.emoji}</span>
              <b>{r.label}</b>
              <small>{r.blurb}</small>
            </button>
          ))}
        </div>
        {left !== null && (
          <p className="wrxBudget">
            {left === 0 ? 'No golden ribbons left this month.' : `${left} golden ribbon${left === 1 ? '' : 's'} left this month`}
          </p>
        )}
        <input
          className="wrxNote"
          maxLength={280}
          value={message}
          placeholder="Say why (optional)"
          onChange={event => setMessage(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void send() }}
        />
        {error && <p className="wrxError" role="alert">{error}</p>}
        <button type="button" className={`wrxSend ${kind}`} disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending...' : <><Award size={16} /> Give {ribbonStyle(kind).label}</>}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Root host: crowns the champion on screen and fires milestone confetti */
/* ------------------------------------------------------------------ */

type Moment = {
  key: string
  kicker: string
  title: string
  line: string
  photo?: string | null
  kind: RibbonKind
  done: () => void
}

type MajorRecognitionAward = {
  id: string
  employee_id: string
  award_month: string
  performance_month: string
  badge_code: string
  badge_label: string
  score: number | string
  awarded_at: string
}

function recognitionMonthLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const CHAMP_SEEN = 'ra-champion-celebrated'

export function RecognitionHost() {
  const [signedIn, setSignedIn] = useState(false)
  const [queue, setQueue] = useState<Moment[]>([])
  const [achievementQueue, setAchievementQueue] = useState<DepartmentAchievement[]>([])
  const [majorAward, setMajorAward] = useState<MajorRecognitionAward | null>(null)
  const { champion, photo } = useChampion()
  const queued = useRef<Set<string>>(new Set())
  const achievementQueued = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!maybeSupabase) return
    let live = true
    void supabase.auth.getSession().then(({ data }) => { if (live) setSignedIn(Boolean(data.session)) })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)))
    return () => { live = false; sub.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (signedIn) return
    setAchievementQueue([])
    setMajorAward(null)
    achievementQueued.current.clear()
  }, [signedIn])

  const push = useCallback((moment: Moment) => {
    if (queued.current.has(moment.key)) return
    queued.current.add(moment.key)
    let called = false
    const once = () => { if (!called) { called = true; moment.done() } }
    setQueue(list => [...list, { ...moment, done: once }])
  }, [])

  // Celebrate each new Golden of the Week once per device.
  useEffect(() => {
    if (!signedIn || !champion) return
    let seen = ''
    try { seen = localStorage.getItem(CHAMP_SEEN) || '' } catch { /* private mode */ }
    if (seen === champion.week_start) return
    void supabase.auth.getUser().then(({ data }) => {
      const me = data.user?.id
      push({
        key: `champ-${champion.week_start}`,
        kicker: me === champion.user_id ? 'You are' : 'Golden of the Week',
        title: me === champion.user_id ? 'Golden of the Week' : champion.full_name,
        line: ribbonCountLine(champion.total, champion.golden),
        photo,
        kind: 'golden',
        done: () => { try { localStorage.setItem(CHAMP_SEEN, champion.week_start) } catch { /* ignore */ } },
      })
    })
  }, [signedIn, champion, photo, push])

  // Monthly KPI / major personal awards are claimed before display. The RPC
  // inserts durable seen-state atomically, so refreshes and parallel tabs do not replay it.
  const loadMajorAward = useCallback(async () => {
    if (!maybeSupabase) return
    const { data, error } = await supabase.rpc('unseen_major_recognition_award')
    if (error) return
    const row = ((data || []) as MajorRecognitionAward[])[0]
    if (row) setMajorAward(row)
  }, [])

  useEffect(() => {
    if (!signedIn || !maybeSupabase) return
    void loadMajorAward()
  }, [signedIn, loadMajorAward])

  // Department achievements are separate from personal ribbon recognition.
  // unseen_department_achievements atomically claims one authorised achievement
  // before returning it, so refreshes and parallel tabs cannot replay a ceremony.
  // Realtime INSERT payloads are only a refresh signal.
  const loadDepartmentAchievements = useCallback(async () => {
    if (!maybeSupabase) return
    const { data, error } = await supabase.rpc('unseen_department_achievements')
    if (error) return
    const rows = (data || []) as DepartmentAchievement[]
    setAchievementQueue(current => {
      const next = [...current]
      for (const row of rows) {
        if (achievementQueued.current.has(row.id)) continue
        achievementQueued.current.add(row.id)
        next.push(row)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!signedIn || !maybeSupabase) return
    void loadDepartmentAchievements()
    let timer: number | null = null
    const channel = supabase
      .channel(`department-achievements-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'department_achievements' }, () => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => { void loadDepartmentAchievements() }, 500)
      })
      .subscribe()
    return () => { if (timer) window.clearTimeout(timer); void supabase.removeChannel(channel) }
  }, [signedIn, loadDepartmentAchievements])

  const current = queue[0] || null
  const currentAchievement = achievementQueue[0] || null

  const close = useCallback(() => {
    setQueue(list => {
      list[0]?.done()
      return list.slice(1)
    })
  }, [])

  const closeAchievement = useCallback(() => {
    setAchievementQueue(list => list.slice(1))
    void loadDepartmentAchievements()
  }, [loadDepartmentAchievements])

  const closeMajorAward = useCallback(() => {
    setMajorAward(null)
    void loadMajorAward()
  }, [loadMajorAward])

  if (current) {
    return (
      <WorkCelebration
        ribbon={{ id: current.key, kind: current.kind, message: '' }}
        giverName={current.line}
        kicker={current.kicker}
        title={current.title}
        photoUrl={current.photo}
        holdMs={7000}
        onClose={close}
      />
    )
  }

  if (majorAward) {
    return (
      <PremiumCelebrationStage
        open
        intensity="major"
        kicker="Monthly KPI achievement"
        title={majorAward.badge_label}
        message={`Outstanding performance for ${recognitionMonthLabel(majorAward.performance_month)}.`}
        detail={`Score ${majorAward.score}`}
        icon={<Award size={88} strokeWidth={1.5} />}
        introMs={1600}
        holdMs={7000}
        onClose={closeMajorAward}
      />
    )
  }

  if (currentAchievement) {
    return (
      <DepartmentAchievementCeremony
        achievement={currentAchievement}
        onClose={closeAchievement}
      />
    )
  }

  return null
}

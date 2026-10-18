import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Award, SmilePlus, X } from 'lucide-react'
import { supabase as maybeSupabase } from '../lib/supabase'
import {
  BUZZ_PATTERN, MORE_WORK_REACTIONS, QUICK_WORK_REACTIONS, RIBBONS, groupReactions, isFreshRibbon, ribbonStyle,
  toggleReactionLocal,
} from '../lib/workReactions'
import type { ReactionRow, RibbonKind, RibbonRow, UnseenRibbon } from '../lib/workReactions'
import '../work-reactions.css'
import { WorkCelebration } from './RibbonCelebration'

export { WorkCelebration }

// The client is missing only when the app is not configured; every entry point below checks first.
const supabase = maybeSupabase as NonNullable<typeof maybeSupabase>

export type WorkReactionsApi = {
  me: string | null
  isAdmin: boolean
  canGive: boolean
  reactions: ReactionRow[]
  ribbons: RibbonRow[]
  nameOf: (id: string) => string
  toggle: (itemId: string, emoji: string) => Promise<void>
  give: (itemId: string, kind: RibbonKind, message: string) => Promise<string | null>
  remove: (ribbonId: string) => Promise<void>
  celebration: RibbonRow | null
  celebrate: (row: RibbonRow | null) => void
  thanks: Array<{ ribbon_id: string; user_id: string }>
  thank: (ribbonId: string) => Promise<void>
  budget: RibbonBudget | null
}

export type RibbonBudget = { golden_limit: number; golden_used: number; unlimited: boolean }

// Loads reactions and ribbons for a set of tasks and keeps them live.
// announceIncoming: show the celebration when someone else gives a ribbon.
export function useWorkReactions(ids: string[], announceIncoming = false): WorkReactionsApi {
  const [me, setMe] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canGive, setCanGive] = useState(false)
  const [reactions, setReactions] = useState<ReactionRow[]>([])
  const [ribbons, setRibbons] = useState<RibbonRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [celebration, setCelebration] = useState<RibbonRow | null>(null)
  const [thanks, setThanks] = useState<Array<{ ribbon_id: string; user_id: string }>>([])
  const [budget, setBudget] = useState<RibbonBudget | null>(null)
  const key = useMemo(() => [...ids].sort().join(','), [ids])
  const idsRef = useRef<string[]>([])
  const meRef = useRef<string | null>(null)
  const seen = useRef<Set<string>>(new Set())
  const timer = useRef<number | null>(null)
  idsRef.current = key ? key.split(',') : []
  meRef.current = me

  useEffect(() => {
    if (!maybeSupabase) return
    let live = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      const id = data.user?.id || null
      if (!live || !id) return
      setMe(id)
      const [profile, give] = await Promise.all([
        supabase.from('employee_profiles').select('role').eq('id', id).maybeSingle(),
        supabase.rpc('can_give_work_ribbon'),
      ])
      if (!live) return
      setIsAdmin(String(profile.data?.role || '').toLowerCase() === 'admin')
      setCanGive(give.data === true)
      if (give.data === true) {
        const spent = await supabase.rpc('my_ribbon_budget')
        const row = Array.isArray(spent.data) ? spent.data[0] : spent.data
        if (live && row) setBudget(row as RibbonBudget)
      }
    })()
    return () => { live = false }
  }, [])

  const load = useCallback(async () => {
    const list = idsRef.current
    if (!maybeSupabase) return
    if (!list.length) { setReactions([]); setRibbons([]); return }
    const [r, b] = await Promise.all([
      supabase.from('work_item_reactions').select('id,work_item_id,user_id,emoji,created_at').in('work_item_id', list),
      supabase.from('work_ribbons').select('id,work_item_id,given_by,kind,message,created_at').in('work_item_id', list),
    ])
    if (!r.error) setReactions((r.data || []) as ReactionRow[])
    if (!b.error) {
      const rows = (b.data || []) as RibbonRow[]
      setRibbons(rows)
      if (announceIncoming) {
        const fresh = rows.filter(row =>
          !seen.current.has(row.id) && row.given_by !== meRef.current && isFreshRibbon(row))
        const top = fresh.find(row => row.kind === 'golden') || fresh[0]
        if (top) setCelebration(top)
      }
      rows.forEach(row => seen.current.add(row.id))
    }
    const ribbonIds = ((b.data || []) as RibbonRow[]).map(row => row.id)
    let thanked: Array<{ ribbon_id: string; user_id: string }> = []
    if (ribbonIds.length) {
      const t = await supabase.from('ribbon_thanks').select('ribbon_id,user_id').in('ribbon_id', ribbonIds)
      if (!t.error) thanked = (t.data || []) as Array<{ ribbon_id: string; user_id: string }>
    }
    setThanks(thanked)
    const need = new Set<string>()
    thanked.forEach(row => need.add(row.user_id))
    ;((r.data || []) as ReactionRow[]).forEach(row => need.add(row.user_id))
    ;((b.data || []) as RibbonRow[]).forEach(row => need.add(row.given_by))
    if (need.size) {
      const { data } = await supabase.from('employee_profiles').select('id,full_name,email').in('id', [...need])
      if (data) {
        setNames(prev => {
          const next = { ...prev }
          for (const p of data as Array<{ id: string; full_name: string; email: string }>) {
            next[p.id] = p.full_name || p.email || 'Teammate'
          }
          return next
        })
      }
    }
  }, [announceIncoming])

  const reload = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void load() }, 250)
  }, [load])

  useEffect(() => { void load() }, [key, load])

  useEffect(() => {
    if (!maybeSupabase) return
    const channel = supabase
      .channel(`work-reactions-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_item_reactions' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_ribbons' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ribbon_thanks' }, reload)
      .subscribe()
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [reload])

  const toggle = useCallback(async (itemId: string, emoji: string) => {
    const who = meRef.current
    if (!who) return
    setReactions(rows => toggleReactionLocal(rows, itemId, who, emoji))
    const { error } = await supabase.rpc('react_to_work_item', { p_item: itemId, p_emoji: emoji })
    if (error) void load()
  }, [load])

  const give = useCallback(async (itemId: string, kind: RibbonKind, message: string) => {
    const { data, error } = await supabase.rpc('give_work_ribbon', { p_item: itemId, p_kind: kind, p_message: message })
    if (error) return error.message
    const row: RibbonRow = {
      id: String(data), work_item_id: itemId, given_by: meRef.current || '', kind, message,
      created_at: new Date().toISOString(),
    }
    seen.current.add(row.id)
    setCelebration(row)
    void load()
    void supabase.rpc('my_ribbon_budget').then(spent => {
      const first = Array.isArray(spent.data) ? spent.data[0] : spent.data
      if (first) setBudget(first as RibbonBudget)
    })
    return null
  }, [load])

  const remove = useCallback(async (ribbonId: string) => {
    setRibbons(rows => rows.filter(row => row.id !== ribbonId))
    const { error } = await supabase.rpc('remove_work_ribbon', { p_ribbon: ribbonId })
    if (error) void load()
  }, [load])

  const thank = useCallback(async (ribbonId: string) => {
    const who = meRef.current
    if (!who) return
    setThanks(rows => (rows.some(row => row.ribbon_id === ribbonId && row.user_id === who)
      ? rows : [...rows, { ribbon_id: ribbonId, user_id: who }]))
    const { error } = await supabase.rpc('thank_ribbon', { p_ribbon: ribbonId })
    if (error) void load()
  }, [load])

  const nameOf = useCallback((id: string) => (id === meRef.current ? 'You' : names[id] || 'Teammate'), [names])

  return { me, isAdmin, canGive, reactions, ribbons, nameOf, toggle, give, remove, celebration, celebrate: setCelebration, thanks, thank, budget }
}

type BarProps = { itemId: string; status: string; rx: WorkReactionsApi; recipients?: string[] }

// Ribbons on the task, the reaction chips, and the buttons to add more.
export function WorkReactionBar({ itemId, status, rx, recipients }: BarProps) {
  const [palette, setPalette] = useState(false)
  const [ribbonOpen, setRibbonOpen] = useState(false)
  const [kind, setKind] = useState<RibbonKind>('golden')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [down, setDown] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const mine = useMemo(() => rx.reactions.filter(r => r.work_item_id === itemId), [rx.reactions, itemId])
  const groups = useMemo(() => groupReactions(mine, rx.me), [mine, rx.me])
  const ribbons = useMemo(
    () => rx.ribbons.filter(r => r.work_item_id === itemId)
      .sort((a, b) => (a.kind === 'golden' ? -1 : 0) - (b.kind === 'golden' ? -1 : 0) || a.created_at.localeCompare(b.created_at)),
    [rx.ribbons, itemId],
  )
  const thanksFor = (ribbonId: string) => rx.thanks.filter(row => row.ribbon_id === ribbonId).map(row => row.user_id)
  const canThank = (ribbon: RibbonRow) =>
    Boolean(rx.me && recipients?.includes(rx.me) && ribbon.given_by !== rx.me && !thanksFor(ribbon.id).includes(rx.me))
  const goldenLeft = rx.budget && !rx.budget.unlimited ? Math.max(0, rx.budget.golden_limit - rx.budget.golden_used) : null
  const ribbonAllowed = rx.canGive && status !== 'draft' && status !== 'cancelled'

  useEffect(() => {
    if (!palette && !ribbonOpen) return
    const away = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setPalette(false)
        setRibbonOpen(false)
      }
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [palette, ribbonOpen])

  async function send() {
    setBusy(true)
    setError('')
    const problem = await rx.give(itemId, kind, message.trim())
    setBusy(false)
    if (problem) { setError(problem); return }
    setMessage('')
    setRibbonOpen(false)
  }

  return (
    <div className="wrx" ref={rootRef} onDoubleClick={event => event.stopPropagation()}>
      {ribbons.length > 0 && (
        <div className="wrxRibbons">
          {ribbons.map(ribbon => {
            const style = ribbonStyle(ribbon.kind)
            const canRemove = ribbon.given_by === rx.me || rx.isAdmin
            return (
              <div key={ribbon.id} className={`wrxRibbon ${ribbon.kind}`}>
                <span className="wrxRibbonIcon" aria-hidden="true">{style.emoji}</span>
                <span className="wrxRibbonText">
                  <b>{style.label}</b>
                  <em>from {rx.nameOf(ribbon.given_by)}</em>
                  {ribbon.message && <span>{ribbon.message}</span>}
                  {thanksFor(ribbon.id).length > 0 && (
                    <span className="wrxThanked">🙏 Thanks from {thanksFor(ribbon.id).map(rx.nameOf).join(', ')}</span>
                  )}
                </span>
                {canThank(ribbon) && (
                  <button type="button" className="wrxThankBtn" onClick={() => void rx.thank(ribbon.id)}>
                    Say thanks 🙏
                  </button>
                )}
                {canRemove && (
                  <button
                    type="button"
                    className="wrxRibbonX"
                    aria-label={`Remove ${style.label}`}
                    title="Remove ribbon"
                    onClick={() => void rx.remove(ribbon.id)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="wrxRow">
        {groups.map(group => (
          <button
            key={group.emoji}
            type="button"
            className={`wrxChip${group.mine ? ' mine' : ''}`}
            aria-pressed={group.mine}
            title={group.userIds.map(rx.nameOf).join(', ')}
            onClick={() => void rx.toggle(itemId, group.emoji)}
          >
            <span>{group.emoji}</span>
            <b>{group.count}</b>
          </button>
        ))}

        <div className="wrxAnchor">
          <button
            type="button"
            className="wrxAdd"
            aria-label="Add a reaction"
            aria-expanded={palette}
            onClick={() => { setDown((rootRef.current?.getBoundingClientRect().top ?? 999) < 420); setPalette(open => !open); setRibbonOpen(false) }}
          >
            <SmilePlus size={16} />
          </button>
          {palette && (
            <div className={`wrxPalette${down ? ' down' : ''}`} role="menu">
              <div className="wrxQuick">
                {QUICK_WORK_REACTIONS.map(emoji => (
                  <button key={emoji} type="button" aria-label={emoji}
                    onClick={() => { void rx.toggle(itemId, emoji); setPalette(false) }}>{emoji}</button>
                ))}
              </div>
              <div className="wrxMore">
                {MORE_WORK_REACTIONS.map(emoji => (
                  <button key={emoji} type="button" aria-label={emoji}
                    onClick={() => { void rx.toggle(itemId, emoji); setPalette(false) }}>{emoji}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {ribbonAllowed && (
          <div className="wrxAnchor">
            <button
              type="button"
              className="wrxGive"
              aria-expanded={ribbonOpen}
              onClick={() => { setDown((rootRef.current?.getBoundingClientRect().top ?? 999) < 420); setRibbonOpen(open => !open); setPalette(false); setError('') }}
            >
              <Award size={16} />
              Give ribbon
            </button>
            {ribbonOpen && (
              <div className={`wrxGivePanel${down ? ' down' : ''}`}>
                <div className="wrxKinds">
                  {RIBBONS.map(r => (
                    <button
                      key={r.kind}
                      type="button"
                      className={`wrxKind ${r.kind}${kind === r.kind ? ' on' : ''}`}
                      aria-pressed={kind === r.kind}
                      disabled={r.kind === 'golden' && goldenLeft === 0}
                      onClick={() => setKind(r.kind)}
                    >
                      <span aria-hidden="true">{r.emoji}</span>
                      <b>{r.label}</b>
                      <small>{r.blurb}</small>
                    </button>
                  ))}
                </div>
                {goldenLeft !== null && (
                  <p className="wrxBudget">
                    {goldenLeft === 0
                      ? 'No golden ribbons left this month. The others are still open.'
                      : `${goldenLeft} golden ribbon${goldenLeft === 1 ? '' : 's'} left this month`}
                  </p>
                )}
                <p className="wrxBudget">Ribbons show on the Hall of Fame.</p>
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
                  {busy ? 'Sending...' : `Give ${ribbonStyle(kind).label}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Sits in the app shell. When ribbons are waiting it buzzes once, shows a
// wrapped gift, and unwraps into the celebration when the person taps it.
export function RibbonGiftHost() {
  const [signedIn, setSignedIn] = useState(false)
  const [waiting, setWaiting] = useState<UnseenRibbon[]>([])
  const [opening, setOpening] = useState<UnseenRibbon | null>(null)
  const [showing, setShowing] = useState<UnseenRibbon | null>(null)
  const [thanked, setThanked] = useState<Set<string>>(new Set())
  const buzzed = useRef<Set<string>>(new Set())
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!maybeSupabase) return
    let live = true
    void supabase.auth.getSession().then(({ data }) => { if (live) setSignedIn(Boolean(data.session)) })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)))
    return () => { live = false; sub.subscription.unsubscribe() }
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('unseen_work_ribbons')
    if (error) return
    const rows = (data || []) as UnseenRibbon[]
    setWaiting(rows)
    const fresh = rows.filter(row => !buzzed.current.has(row.id))
    if (fresh.length) {
      fresh.forEach(row => buzzed.current.add(row.id))
      try { navigator.vibrate?.(BUZZ_PATTERN) } catch { /* Not every browser can buzz. */ }
      chime()
    }
  }, [])

  useEffect(() => {
    if (!maybeSupabase || !signedIn) { setWaiting([]); return }
    void load()
    const channel = supabase
      .channel(`ribbon-gifts-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_ribbons' }, () => {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { void load() }, 400)
      })
      .subscribe()
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [signedIn, load])

  function unwrap() {
    const next = waiting[0]
    if (!next) return
    setOpening(next)
    window.setTimeout(() => {
      setOpening(null)
      setShowing(next)
      setWaiting(rows => rows.filter(row => row.id !== next.id))
      void supabase.rpc('mark_work_ribbons_seen', { p_ids: [next.id] })
    }, 1100)
  }

  const closeShow = useCallback(() => setShowing(null), [])

  if (!signedIn) return null
  const top = opening || waiting[0] || null

  return (
    <>
      {top && !showing && (
        <button
          type="button"
          className={`wrxGift ${top.kind}${opening ? ' opening' : ''}`}
          onClick={unwrap}
          disabled={Boolean(opening)}
          aria-label={`Unwrap ${ribbonStyle(top.kind).label} from ${top.giver_name}`}
        >
          <span className="wrxGiftBox" aria-hidden="true">
            <i className="lid" /><i className="body" /><i className="bowL" /><i className="bowR" />
            <i className="spark s1" /><i className="spark s2" /><i className="spark s3" />
          </span>
          <span className="wrxGiftText">
            <b>{waiting.length > 1 ? `${waiting.length} ribbons waiting` : 'A ribbon is waiting'}</b>
            <small>{opening ? 'Unwrapping...' : `From ${top.giver_name}. Tap to unwrap`}</small>
          </span>
        </button>
      )}
      <WorkCelebration
        ribbon={showing}
        giverName={showing ? `from ${showing.giver_name}` : ''}
        task={showing?.task_title}
        onClose={closeShow}
        onThanks={showing ? () => {
          setThanked(prev => new Set(prev).add(showing.id))
          void supabase.rpc('thank_ribbon', { p_ribbon: showing.id })
        } : undefined}
        thanked={showing ? thanked.has(showing.id) : false}
      />
    </>
  )
}

// A soft two-note chime. Browsers may refuse until the page has been touched.
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + i * 0.14)
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.14 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.14)
      osc.stop(now + i * 0.14 + 0.55)
    })
    window.setTimeout(() => { void ctx.close() }, 1400)
  } catch { /* A missing chime is fine. */ }
}

type GrantPerson = { id: string; full_name: string; email: string; role: string; department: string | null }

// Admin only. Choose who may hand out ribbons.
export function RibbonPermissions({ onClose }: { onClose: () => void }) {
  const [people, setPeople] = useState<GrantPerson[]>([])
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!maybeSupabase) return
    let live = true
    void (async () => {
      const [p, g] = await Promise.all([
        supabase.from('employee_profiles').select('id,full_name,email,role,department').eq('active', true).order('full_name'),
        supabase.from('work_ribbon_grants').select('user_id,golden_monthly_limit'),
      ])
      if (!live) return
      if (p.error || g.error) setError('Could not load people.')
      setPeople((p.data || []) as GrantPerson[])
      const rows = (g.data || []) as Array<{ user_id: string; golden_monthly_limit: number }>
      setGranted(new Set(rows.map(row => row.user_id)))
      setLimits(Object.fromEntries(rows.map(row => [row.user_id, row.golden_monthly_limit])))
      setLoading(false)
    })()
    return () => { live = false }
  }, [])

  async function set(id: string, allowed: boolean) {
    setError('')
    setGranted(prev => {
      const next = new Set(prev)
      if (allowed) next.add(id); else next.delete(id)
      return next
    })
    if (allowed) setLimits(prev => ({ ...prev, [id]: prev[id] ?? 3 }))
    const { error: problem } = await supabase.rpc('set_work_ribbon_grant', { p_user: id, p_allowed: allowed })
    if (problem) {
      setError(problem.message)
      setGranted(prev => {
        const next = new Set(prev)
        if (allowed) next.delete(id); else next.add(id)
        return next
      })
    }
  }

  async function setLimit(id: string, value: number) {
    const clean = Math.max(0, Math.min(50, Math.round(value) || 0))
    setLimits(prev => ({ ...prev, [id]: clean }))
    const { error: problem } = await supabase.rpc('set_work_ribbon_grant', { p_user: id, p_allowed: true, p_limit: clean })
    if (problem) setError(problem.message)
  }

  const shown = people.filter(p => {
    const q = query.trim().toLowerCase()
    return !q || `${p.full_name} ${p.email} ${p.department || ''}`.toLowerCase().includes(q)
  })

  return (
    <div className="wrxModal" role="dialog" aria-label="Ribbon permissions" onClick={onClose}>
      <div className="wrxModalCard" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h3>Who can give ribbons</h3>
            <p>Admins always can, with no limit. Everyone can still react with emoji. Set how many golden ribbons each person can give per month.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <input value={query} placeholder="Search people" onChange={event => setQuery(event.target.value)} />
        {error && <p className="wrxError" role="alert">{error}</p>}
        <div className="wrxPeople">
          {loading && <p className="wrxEmpty">Loading...</p>}
          {shown.map(person => {
            const always = person.role.toLowerCase() === 'admin'
            const on = always || granted.has(person.id)
            return (
              <div key={person.id} className="wrxPerson">
                <span>
                  <b>{person.full_name || person.email}</b>
                  <small>{[person.department, always ? 'Admin' : ''].filter(Boolean).join(' · ') || person.email}</small>
                </span>
                <span className="wrxPersonCtl">
                  {on && !always && (
                    <span className="wrxLimitBox">
                      <small>golden / month</small>
                      <input
                        className="wrxLimit"
                        type="number"
                        min={0}
                        max={50}
                        value={limits[person.id] ?? 3}
                                                onChange={event => void setLimit(person.id, Number(event.target.value))}
                      />
                    </span>
                  )}
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Ribbons for ${person.full_name || person.email}`}
                    checked={on}
                    disabled={always}
                    onChange={event => void set(person.id, event.target.checked)}
                  />
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

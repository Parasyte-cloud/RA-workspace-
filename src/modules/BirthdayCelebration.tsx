import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cake, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resolveEmployeeAvatarUrl } from '../lib/employeeAvatar'
import '../birthday.css'

type Person = {
  employee_id: string
  full_name: string
  department: string | null
  job_title: string | null
  avatar_path: string | null
  is_me: boolean
}

type Wish = { from_name: string; message: string; created_at: string }

const RIBBON = ['#ff9900', '#e94b8b', '#7a4cc2', '#315bc1', '#1f9d55', '#ffc83d', '#ff6b4a']
const QUICK_WISHES = [
  'Happy birthday! Wishing you a wonderful year ahead.',
  'Many happy returns! Enjoy your day.',
  'Happy birthday! Thank you for all you do for the team.',
]
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const seenKey = (id: string) => `ra.bday.seen.${id}.${todayKey()}`
const hiddenKey = (id: string) => `ra.bday.hide.${id}.${todayKey()}`

function remembered(key: string) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function remember(key: string) {
  try { localStorage.setItem(key, '1') } catch { /* the card may show again after a reload */ }
}

// Confetti made of ribbon-coloured pieces. The numbers are derived from the
// index so the pieces are spread out and do not change between renders.
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 56 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 53) % 40) / 10,
        duration: 4.5 + ((i * 29) % 35) / 10,
        size: 7 + ((i * 11) % 9),
        color: RIBBON[i % RIBBON.length],
        shape: i % 3 === 0 ? 'round' : i % 3 === 1 ? 'strip' : 'square',
        spin: 240 + ((i * 47) % 480),
      })),
    [],
  )
  return (
    <div className="bdConfetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={p.shape}
          style={{
            left: `${p.left}%`,
            width: p.shape === 'strip' ? p.size / 2.2 : p.size,
            height: p.shape === 'strip' ? p.size * 1.8 : p.size,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--spin' as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  )
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
}

// Mounted once in the workspace shell. The birthday person gets a celebration
// the first time they open the workspace that day; colleagues get a small card
// where they can send a wish.
export default function BirthdayCelebration() {
  const [people, setPeople] = useState<Person[]>([])
  const [meId, setMeId] = useState('')
  const [open, setOpen] = useState(false)
  const [avatar, setAvatar] = useState('')
  const [wishes, setWishes] = useState<Wish[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [composing, setComposing] = useState('')
  const [text, setText] = useState('')
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const me = people.find(p => p.is_me)
  const others = people.filter(p => !p.is_me && !hidden.has(p.employee_id) && !sent.has(p.employee_id))

  const load = useCallback(async () => {
    const client = supabase
    if (!client) return
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) return
    setMeId(auth.user.id)
    const { data, error: rpcError } = await client.rpc('get_birthdays_today')
    if (rpcError) return // the migration is not installed yet: stay quiet
    const list = (data || []) as Person[]
    setPeople(list)
    setHidden(new Set(list.filter(p => remembered(hiddenKey(p.employee_id))).map(p => p.employee_id)))
    const mine = list.find(p => p.is_me)
    if (mine && !remembered(seenKey(mine.employee_id))) setOpen(true)
  }, [])

  useEffect(() => { void load() }, [load])

  // Check again when the tab comes back, so it also works across midnight.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useEffect(() => {
    if (!me?.avatar_path) { setAvatar(''); return }
    let live = true
    void resolveEmployeeAvatarUrl(me.avatar_path).then(url => { if (live) setAvatar(url || '') })
    return () => { live = false }
  }, [me?.avatar_path])

  // Wishes arrive during the day.
  useEffect(() => {
    const client = supabase
    if (!client || !open || !me) return
    let live = true
    const pull = async () => {
      const { data } = await client.rpc('get_my_birthday_wishes')
      if (live) setWishes((data || []) as Wish[])
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 30_000)
    return () => { live = false; window.clearInterval(timer) }
  }, [open, me])

  const close = () => {
    if (meId) remember(seenKey(meId))
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // close only reads meId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meId])

  const hide = (person: Person) => {
    remember(hiddenKey(person.employee_id))
    setHidden(current => new Set(current).add(person.employee_id))
  }

  const send = async (person: Person) => {
    const client = supabase
    if (!client || busy || !text.trim()) return
    setBusy(true)
    setError('')
    const { error: rpcError } = await client.rpc('send_birthday_wish', { p_to: person.employee_id, p_message: text.trim() })
    setBusy(false)
    if (rpcError) {
      if (/already sent/i.test(rpcError.message)) setSent(current => new Set(current).add(person.employee_id))
      setError(rpcError.message)
      return
    }
    setSent(current => new Set(current).add(person.employee_id))
    setComposing('')
    setText('')
  }

  const first = me ? me.full_name.split(/\s+/)[0] : ''

  return (
    <>
      {open && me && (
        <div className="bdBack" role="dialog" aria-modal="true" aria-label={`Happy birthday ${first}`} onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
          <Confetti />
          <div className="bdCard">
            <div className="bdBands" aria-hidden="true">{RIBBON.map(c => <i key={c} style={{ background: c }} />)}</div>
            <button type="button" className="bdClose" onClick={close} aria-label="Close"><X size={18} /></button>

            <div className="bdBanner" aria-hidden="true"><span>MAKE A WISH</span></div>

            <div className="bdAvatar">
              {avatar ? <img src={avatar} alt="" /> : <span>{initials(me.full_name)}</span>}
            </div>

            <h2>Happy Birthday</h2>
            <h1>{first}!</h1>
            <p className="bdLead">
              Everyone at RideArrivo is celebrating you today. Thank you for the energy, the ideas and the care you bring to the team.
            </p>

            {wishes.length > 0 && (
              <div className="bdWishes">
                <strong>Wishes from your colleagues</strong>
                <ul>
                  {wishes.map((w, i) => (
                    <li key={i}><span>{w.from_name}</span>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <button type="button" className="bdThanks" onClick={close}>Thank you</button>
          </div>
        </div>
      )}

      {others.length > 0 && !open && (
        <div className="bdToday" role="status">
          {others.slice(0, 3).map(person => (
            <div className="bdTodayCard" key={person.employee_id}>
              <div className="bdTodayBands" aria-hidden="true">{RIBBON.map(c => <i key={c} style={{ background: c }} />)}</div>
              <div className="bdTodayRow">
                <span className="bdTodayIcon"><Cake size={18} /></span>
                <div>
                  <strong>It is {person.full_name}'s birthday</strong>
                  <small>{[person.job_title, person.department].filter(Boolean).join(' · ') || 'Send them a wish'}</small>
                </div>
                <button type="button" className="bdMini" onClick={() => { setComposing(composing === person.employee_id ? '' : person.employee_id); setText(QUICK_WISHES[0]); setError('') }}>
                  Send wishes
                </button>
                <button type="button" className="bdX" onClick={() => hide(person)} aria-label="Hide"><X size={14} /></button>
              </div>
              {composing === person.employee_id && (
                <div className="bdCompose">
                  <div className="bdChips">
                    {QUICK_WISHES.map(w => (
                      <button type="button" key={w} className={text === w ? 'on' : ''} onClick={() => setText(w)}>{w}</button>
                    ))}
                  </div>
                  <textarea rows={2} maxLength={300} value={text} onChange={e => setText(e.target.value)} aria-label="Your wish" />
                  {error && <small className="bdError">{error}</small>}
                  <button type="button" className="bdSend" disabled={busy || !text.trim()} onClick={() => void send(person)}>
                    <Send size={14} />{busy ? 'Sending...' : 'Send'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

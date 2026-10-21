import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Cake, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCelebrationMotionProfile } from '../components/celebrations/useCelebrationMotionProfile'
import type { CeremonyPresentation } from '../celebrations/types'
import '../birthday.css'

const BirthdayCelebrationScene = lazy(() => import('../components/celebrations/BirthdayCelebrationScene'))

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
const hiddenKey = (id: string) => `ra.bday.hide.${id}.${todayKey()}`

function remembered(key: string) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function remember(key: string) {
  try { localStorage.setItem(key, '1') } catch { /* the card may show again after a reload */ }
}

// Mounted once in the workspace shell. The birthday person gets a celebration
// the first time they open the workspace that day; colleagues get a small card
// where they can send a wish.
export default function BirthdayCelebration() {
  const [people,setPeople]=useState<Person[]>([])
  const [hidden,setHidden]=useState<Set<string>>(new Set())
  const [composing,setComposing]=useState('')
  const [text,setText]=useState('')
  const [sent,setSent]=useState<Set<string>>(new Set())
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [replayOpen,setReplayOpen]=useState(false)
  const { profile: motionProfile } = useCelebrationMotionProfile()
  const me=people.find(p=>p.is_me)
  const others=people.filter(p=>!p.is_me&&!hidden.has(p.employee_id)&&!sent.has(p.employee_id))
  const load=useCallback(async()=>{const client=supabase;if(!client)return;const {data,error:rpcError}=await client.rpc('get_birthdays_today');if(rpcError)return;const list=(data||[]) as Person[];setPeople(list);setHidden(new Set(list.filter(p=>remembered(hiddenKey(p.employee_id))).map(p=>p.employee_id)))},[])
  useEffect(()=>{void load()},[load])
  useEffect(()=>{const onVisible=()=>{if(document.visibilityState==='visible')void load()};document.addEventListener('visibilitychange',onVisible);return()=>document.removeEventListener('visibilitychange',onVisible)},[load])
  const hide=(person:Person)=>{remember(hiddenKey(person.employee_id));setHidden(current=>new Set(current).add(person.employee_id))}
  const send=async(person:Person)=>{const client=supabase;if(!client||busy||!text.trim())return;setBusy(true);setError('');const {error:rpcError}=await client.rpc('send_birthday_wish',{p_to:person.employee_id,p_message:text.trim()});setBusy(false);if(rpcError){if(/already sent/i.test(rpcError.message))setSent(current=>new Set(current).add(person.employee_id));setError(rpcError.message);return}setSent(current=>new Set(current).add(person.employee_id));setComposing('');setText('')}
  if(!others.length&&!me)return null
  const replayPresentation: CeremonyPresentation | null = me ? {
    deliveryId: `birthday-replay:${me.employee_id}:${todayKey()}`,
    sourceKind: 'birthday',
    sourceKey: `birthday-replay:${me.employee_id}:${todayKey()}`,
    audienceType: 'individual',
    priority: 0,
    revision: 1,
    title: `Happy Birthday ${me.full_name.trim().split(/\s+/)[0] || 'to you'}!`,
    message: 'Today is your day. We hope it is a memorable one.',
    detail: 'Make a wish',
    employeeName: me.full_name,
  } : null
  return <>
    <div className="bdToday" role="status">
      {me&&<div className="bdTodayCard bdTodayCardSelf"><div className="bdTodayBands" aria-hidden="true">{RIBBON.map(c=><i key={c} style={{background:c}}/>)}</div><div className="bdTodayRow"><span className="bdTodayIcon"><Cake size={18}/></span><div><strong>Happy Birthday, {me.full_name}</strong><small>Your celebration is always available today.</small></div><button type="button" className="bdMini" onClick={()=>setReplayOpen(true)}>Replay celebration</button></div></div>}
      {others.slice(0,3).map(person=><div className="bdTodayCard" key={person.employee_id}><div className="bdTodayBands" aria-hidden="true">{RIBBON.map(c=><i key={c} style={{background:c}}/>)}</div><div className="bdTodayRow"><span className="bdTodayIcon"><Cake size={18}/></span><div><strong>It is {person.full_name}'s birthday</strong><small>{[person.job_title,person.department].filter(Boolean).join(' · ')||'Send them a wish'}</small></div><button type="button" className="bdMini" onClick={()=>{setComposing(composing===person.employee_id?'':person.employee_id);setText(QUICK_WISHES[0]);setError('')}}>Send wishes</button><button type="button" className="bdX" onClick={()=>hide(person)} aria-label="Hide"><X size={14}/></button></div>{composing===person.employee_id&&<div className="bdCompose"><div className="bdChips">{QUICK_WISHES.map(w=><button type="button" key={w} className={text===w?'on':''} onClick={()=>setText(w)}>{w}</button>)}</div><textarea rows={2} maxLength={300} value={text} onChange={e=>setText(e.target.value)} aria-label="Your wish"/>{error&&<small className="bdError">{error}</small>}<button type="button" className="bdSend" disabled={busy||!text.trim()} onClick={()=>void send(person)}><Send size={14}/>{busy?'Sending...':'Send'}</button></div>}</div>)}
    </div>
    {replayOpen&&replayPresentation&&<Suspense fallback={null}><BirthdayCelebrationScene presentation={replayPresentation} profile={motionProfile} onReady={()=>{}} onClose={()=>setReplayOpen(false)}/></Suspense>}
  </>
}

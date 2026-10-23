import { useEffect, useMemo, useState } from 'react'
import { Cake, Gift } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { resolveEmployeeAvatarUrl } from '../../lib/employeeAvatar'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import SeasonalParticleField from './SeasonalParticleField'
import SeasonalStaticFallback from './SeasonalStaticFallback'
import type { CelebrationMotionProfile } from './useCelebrationMotionProfile'
import type { CeremonyPresentation } from '../../celebrations/types'
import '../../birthday.css'
import '../../seasonal-celebrations.css'

type Wish={from_name:string;message:string;created_at:string}
const PALETTE=['#ff9f1c','#f472b6','#a78bfa','#60a5fa','#facc15','#f8fafc'] as const
const SYMBOLS=['✦','●','◆','🎁','✧'] as const

export default function BirthdayCelebrationScene({presentation,profile,onReady,onClose}:{presentation:CeremonyPresentation;profile:CelebrationMotionProfile;onReady:()=>void;onClose:()=>void}){
 const [photo,setPhoto]=useState(''); const [wishes,setWishes]=useState<Wish[]>([])
 useEffect(()=>{ const client=supabase;if(!client)return;let live=true; void client.rpc('get_birthdays_today').then(async({data})=>{const me=(data||[]).find((p:any)=>p.is_me);if(live&&me?.avatar_path)setPhoto(await resolveEmployeeAvatarUrl(me.avatar_path)||'')}); void client.rpc('get_my_birthday_wishes').then(({data})=>{if(live)setWishes((data||[]) as Wish[])}); return()=>{live=false}},[])
 const first=useMemo(()=>presentation.employeeName?.trim().split(/\s+/)[0]||'you',[presentation.employeeName])
 if(profile==='static')return <SeasonalStaticFallback presentation={{...presentation,title:presentation.title||`Happy Birthday ${first}!`,detail:presentation.detail||'Make a wish'}} holdMs={9000} onReady={onReady} onClose={onClose}/>
 return <PremiumCelebrationStage open staticVisuals={profile==='reduced'} intensity="birthday" kicker="RideArrivo celebrates you" title={presentation.title||`Happy Birthday ${first}!`} message={presentation.message||undefined} detail={presentation.detail||'Make a wish'} photoUrl={photo||null} icon={<Cake size={86}/>} introMs={profile==='reduced'?0:1800} holdMs={9000} onPresented={onReady} onClose={onClose}>
   <div className={`birthdayEnhancedScene ${profile==='reduced'?'isReduced':''}`}><div className="birthdayCornerBalloons" aria-hidden="true"><i/><i/><i/><i/></div><SeasonalParticleField profile={profile} fullCount={136} balancedCount={96} palette={PALETTE} symbols={SYMBOLS}/><div className="birthdayCakeMotif" aria-hidden="true"><Cake size={24}/><Gift size={22}/></div>{wishes.length>0&&<div className="bdWishes"><strong>Wishes from your colleagues</strong><ul>{wishes.map((w,i)=><li key={`${w.created_at}:${i}`}><span>{w.from_name}</span>{w.message}</li>)}</ul></div>}</div>
 </PremiumCelebrationStage>
}

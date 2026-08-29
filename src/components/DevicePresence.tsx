import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../device-presence.css'

type Props={
  profileId:string
}

type LocationState={
  latitude:number|null
  longitude:number|null
  accuracy:number|null
  shared:boolean
}

function getBrowserDeviceId(){
  const key='ridearrivo-browser-device-id'
  let value=window.localStorage.getItem(key)
  if(!value){
    value=crypto.randomUUID()
    window.localStorage.setItem(key,value)
  }
  return value
}

function detectBrowser(userAgent:string){
  if(/Edg\//.test(userAgent)) return 'Microsoft Edge'
  if(/Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) return 'Google Chrome'
  if(/Firefox\//.test(userAgent)) return 'Firefox'
  if(/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return 'Safari'
  return 'Browser'
}

function detectOs(userAgent:string,platform:string){
  if(/Windows/i.test(userAgent) || /Win/i.test(platform)) return 'Windows'
  if(/Android/i.test(userAgent)) return 'Android'
  if(/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS/iPadOS'
  if(/Mac/i.test(platform) || /Mac OS X/i.test(userAgent)) return 'macOS'
  if(/Linux/i.test(platform) || /Linux/i.test(userAgent)) return 'Linux'
  return platform || 'Unknown OS'
}

function coarse(value:number){
  return Math.round(value*100)/100
}

export default function DevicePresence({profileId}:Props){
  const [location,setLocation]=useState<LocationState>({latitude:null,longitude:null,accuracy:null,shared:false})
  const locationRef=useRef<LocationState>({latitude:null,longitude:null,accuracy:null,shared:false})
  const [locating,setLocating]=useState(false)
  const [message,setMessage]=useState('')
  const timezone=useMemo(()=>Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone',[])

  const register=useCallback(async(nextLocation?:LocationState)=>{
    const client=supabase
    if(!client || !profileId) return

    const nav=navigator as Navigator & {deviceMemory?:number}
    const browserDeviceId=getBrowserDeviceId()
    const userAgent=navigator.userAgent || ''
    const platform=navigator.platform || ''
    const loc=nextLocation ?? locationRef.current

    const payload={
      employee_id:profileId,
      browser_device_id:browserDeviceId,
      browser_name:detectBrowser(userAgent),
      operating_system:detectOs(userAgent,platform),
      platform,
      user_agent:userAgent,
      screen_width:window.screen?.width || null,
      screen_height:window.screen?.height || null,
      hardware_concurrency:navigator.hardwareConcurrency || null,
      device_memory_gb:nav.deviceMemory ?? null,
      timezone,
      latitude:loc.shared && loc.latitude!==null ? coarse(loc.latitude) : null,
      longitude:loc.shared && loc.longitude!==null ? coarse(loc.longitude) : null,
      location_accuracy_m:loc.shared && loc.accuracy!==null ? Math.round(loc.accuracy) : null,
      location_shared_at:loc.shared ? new Date().toISOString() : null,
      last_seen_at:new Date().toISOString(),
    }

    const {error}=await client
      .from('employee_device_sessions')
      .upsert(payload,{onConflict:'employee_id,browser_device_id'})

    if(error) console.warn('[RideArrivo Device Presence] unable to update session',error.message)
  },[profileId,timezone])

  const shareLocation=useCallback(()=>{
    if(!navigator.geolocation){
      setMessage('Location is not available in this browser.')
      return
    }

    setLocating(true)
    setMessage('')
    navigator.geolocation.getCurrentPosition(
      position=>{
        const next={
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,
          shared:true,
        }
        locationRef.current=next
        setLocation(next)
        window.localStorage.setItem('ridearrivo-location-sharing','granted')
        void register(next)
        setLocating(false)
      },
      error=>{
        setMessage(error.code===1?'Location permission was not granted.':'Unable to read your current location.')
        setLocating(false)
      },
      {enableHighAccuracy:false,maximumAge:300000,timeout:10000}
    )
  },[register])

  useEffect(()=>{
    if(!profileId) return
    void register()

    const timer=window.setInterval(()=>void register(),5*60*1000)
    const onVisible=()=>{ if(document.visibilityState==='visible') void register() }
    document.addEventListener('visibilitychange',onVisible)

    const consent=window.localStorage.getItem('ridearrivo-location-sharing')
    if(consent==='granted'){
      shareLocation()
    }else if(navigator.permissions){
      void navigator.permissions.query({name:'geolocation'}).then(permission=>{
        if(permission.state==='granted') shareLocation()
      }).catch(()=>undefined)
    }

    return ()=>{
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',onVisible)
    }
  },[profileId,register,shareLocation])

  const label=location.shared && location.latitude!==null && location.longitude!==null
    ? `${coarse(location.latitude).toFixed(2)}, ${coarse(location.longitude).toFixed(2)}`
    : timezone

  return (
    <div className="devicePresence">
      <div className="devicePresenceLocation" title={message || 'Location is shared only with your permission and stored at coarse precision.'}>
        <MapPin size={12}/><span>{label}</span>
      </div>
      {!location.shared&&(
        <button type="button" onClick={shareLocation} disabled={locating}>
          {locating?'Locating...':'Share location'}
        </button>
      )}
    </div>
  )
}

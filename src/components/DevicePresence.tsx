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

const CONSENT_VERSION='2026-08-admin-location-v1'
const CONSENT_KEY='ridearrivo-location-sharing'
// Settings drives this component through two window events: the sidebar only shows the address,
// and the on/off switch for sharing lives in Settings.
export const LOCATION_REQUEST_EVENT='ra-location-request'
export const LOCATION_STATE_EVENT='ra-location-state'

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
  const [address,setAddress]=useState('')
  const timezone=useMemo(()=>Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone',[])

  const register=useCallback(async(nextLocation?:LocationState)=>{
    const client=supabase
    if(!client || !profileId) return

    const nav=navigator as Navigator & {deviceMemory?:number}
    const userAgent=navigator.userAgent || ''
    const platform=navigator.platform || ''
    const loc=nextLocation ?? locationRef.current

    const payload={
      browser_device_id:getBrowserDeviceId(),
      browser_name:detectBrowser(userAgent),
      operating_system:detectOs(userAgent,platform),
      platform,
      user_agent:userAgent,
      screen_width:window.screen?.width || null,
      screen_height:window.screen?.height || null,
      hardware_concurrency:navigator.hardwareConcurrency || null,
      device_memory_gb:nav.deviceMemory ?? null,
      timezone,
      location_consent:loc.shared,
      latitude:loc.shared ? loc.latitude : null,
      longitude:loc.shared ? loc.longitude : null,
      location_accuracy_m:loc.shared ? loc.accuracy : null,
    }

    const {data,error}=await client.functions.invoke('workspace-presence',{body:payload})

    if(error){
      console.warn('[RideArrivo Device Presence] unable to update presence',error.message)
      return
    }

    if(typeof data?.address==='string' && data.address.trim()){
      setAddress(data.address.trim())
    }
  },[profileId,timezone])

  const shareLocation=useCallback(()=>{
    if(!navigator.geolocation){
      setMessage('Location is not available in this browser.')
      return
    }

    const storedConsent=window.localStorage.getItem(CONSENT_KEY)
    if(storedConsent!==`granted:${CONSENT_VERSION}`){
      const accepted=window.confirm(
        'Share your precise work sign-in location with RideArrivo?\n\n'+
        'If you continue, your browser will ask for location permission. RideArrivo will record the sign-in coordinates and, when configured, the nearest full address for account security, device support and workplace administration. The location is visible to you and authorised RideArrivo administrators. Sign-in location history is retained for 90 days. You can stop sharing any time in Settings.'
      )
      if(!accepted) return
    }

    setLocating(true)
    setMessage('')

    navigator.geolocation.getCurrentPosition(
      position=>{
        const next:LocationState={
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,
          shared:true,
        }
        locationRef.current=next
        setLocation(next)
        window.localStorage.setItem(CONSENT_KEY,`granted:${CONSENT_VERSION}`)
        void register(next)
        setLocating(false)
      },
      error=>{
        setMessage(error.code===1?'Location permission was not granted.':'Unable to read your current location.')
        setLocating(false)
      },
      {enableHighAccuracy:true,maximumAge:300000,timeout:12000}
    )
  },[register])

  const stopSharing=useCallback(()=>{
    window.localStorage.removeItem(CONSENT_KEY)
    const next:LocationState={latitude:null,longitude:null,accuracy:null,shared:false}
    locationRef.current=next
    setLocation(next)
    setAddress('')
    setMessage('Precise location sharing stopped. Browser permission can also be removed in site settings.')
    void register(next)
  },[register])

  useEffect(()=>{
    if(!profileId) return

    void register()

    const timer=window.setInterval(()=>void register(),5*60*1000)
    const onVisible=()=>{if(document.visibilityState==='visible') void register()}
    document.addEventListener('visibilitychange',onVisible)

    const consent=window.localStorage.getItem(CONSENT_KEY)
    if(consent===`granted:${CONSENT_VERSION}` && navigator.permissions){
      void navigator.permissions.query({name:'geolocation'}).then(permission=>{
        if(permission.state==='granted') shareLocation()
      }).catch(()=>undefined)
    }

    return ()=>{
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',onVisible)
    }
  },[profileId,register,shareLocation])

  useEffect(()=>{
    window.dispatchEvent(new CustomEvent(LOCATION_STATE_EVENT,{detail:{shared:location.shared,locating}}))
  },[location.shared,locating])

  useEffect(()=>{
    const onRequest=(event:Event)=>{
      const wanted=(event as CustomEvent<boolean>).detail
      if(wanted) shareLocation()
      else stopSharing()
    }
    window.addEventListener(LOCATION_REQUEST_EVENT,onRequest)
    return ()=>window.removeEventListener(LOCATION_REQUEST_EVENT,onRequest)
  },[shareLocation,stopSharing])

  const [expanded,setExpanded]=useState(false)
  const label=address
    || (location.shared && location.latitude!==null && location.longitude!==null
      ? `${coarse(location.latitude).toFixed(2)}, ${coarse(location.longitude).toFixed(2)}`
      : timezone)

  // Long addresses slide left in a loop so the sidebar never has to widen. Click shows the whole address.
  const scrolls=label.length>26

  return (
    <div className="devicePresence">
      <div
        className={`devicePresenceLocation${expanded?' expanded':''}${scrolls&&!expanded?' scrolls':''}`}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        title={message || address || 'Device presence is recorded for account security. Precise location is shared only after your permission.'}
        onClick={()=>setExpanded(value=>!value)}
        onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setExpanded(value=>!value)}}}
      >
        <MapPin size={12}/>
        <span className="devicePresenceText">
          {scrolls && !expanded ? (
            <span className="devicePresenceTrack" style={{animationDuration:`${Math.max(14,label.length*0.32)}s`}}>
              <span>{label}</span><span aria-hidden="true">{label}</span>
            </span>
          ) : label}
        </span>
      </div>

    </div>
  )
}

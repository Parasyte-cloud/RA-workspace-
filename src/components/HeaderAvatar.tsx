import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { supabase } from '../lib/supabase'
import { resolveEmployeeAvatarUrl } from '../lib/employeeAvatar'

type Props={
  userId:string
  name:string
}

function initials(name:string){
  const parts=
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)

  if(!parts.length){
    return 'RA'
  }

  return parts
    .slice(0,2)
    .map(part=>part[0]?.toUpperCase() || '')
    .join('')
}

export function HeaderAvatar({
  userId,
  name
}:Props){

  const [avatarUrl,setAvatarUrl]=
    useState<string|null>(null)

  const [failed,setFailed]=
    useState(false)

  const loadAvatar=
    useCallback(async()=>{

      if(!supabase || !userId){
        setAvatarUrl(null)
        return
      }

      const {
        data,
        error
      }=
        await supabase
          .from('employee_profiles')
          .select('avatar_path')
          .eq('id',userId)
          .maybeSingle()

      if(error){
        console.warn(
          'Unable to load header avatar:',
          error.message
        )

        setAvatarUrl(null)
        return
      }

      const value =
        await resolveEmployeeAvatarUrl(
          data?.avatar_path
        )

      setAvatarUrl(value)
      setFailed(false)

    },[userId])

  useEffect(()=>{

    void loadAvatar()

    const reload=()=>{
      void loadAvatar()
    }

    const visibility=()=>{
      if(
        document.visibilityState==='visible'
      ){
        void loadAvatar()
      }
    }

    window.addEventListener(
      'focus',
      reload
    )

    window.addEventListener(
      'ridearrivo:profile-updated',
      reload
    )

    document.addEventListener(
      'visibilitychange',
      visibility
    )

    return ()=>{

      window.removeEventListener(
        'focus',
        reload
      )

      window.removeEventListener(
        'ridearrivo:profile-updated',
        reload
      )

      document.removeEventListener(
        'visibilitychange',
        visibility
      )

    }

  },[loadAvatar])

  return (
    <span
      className="headerAvatar"
      aria-label={`${name || 'Employee'} profile photo`}
    >
      {avatarUrl && !failed
        ? (
          <img
            className="headerAvatarImage"
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={()=>{
              setFailed(true)
            }}
          />
        )
        : (
          <span className="headerAvatarFallback">
            {initials(name)}
          </span>
        )
      }
    </span>
  )
}

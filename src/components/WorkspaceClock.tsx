import {
  useEffect,
  useState
} from 'react'

import './WorkspaceClock.css'

export function WorkspaceClock(){

  const [now,setNow]=
    useState(()=>new Date())

  useEffect(()=>{

    const timer=
      window.setInterval(
        ()=>{
          setNow(new Date())
        },
        1000
      )

    return ()=>{
      window.clearInterval(timer)
    }

  },[])

  const time=
    new Intl.DateTimeFormat(
      undefined,
      {
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit'
      }
    ).format(now)

  const date=
    new Intl.DateTimeFormat(
      undefined,
      {
        weekday:'short',
        day:'2-digit',
        month:'short',
        year:'numeric'
      }
    ).format(now)

  const timezone=
    new Intl.DateTimeFormat(
      undefined,
      {
        timeZoneName:'short'
      }
    )
      .formatToParts(now)
      .find(
        part=>
          part.type==='timeZoneName'
      )
      ?.value || ''

  return (
    <div
      className="workspaceClock"
      aria-label={`${date}, ${time}`}
      title="Local workstation time"
    >
      <strong>
        {time}
      </strong>

      <span>
        {date}
        {timezone
          ? ` · ${timezone}`
          : ''
        }
      </span>
    </div>
  )
}

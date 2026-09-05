import type { ReactNode } from 'react'
import {
  Columns2,
  Maximize2,
  Minimize2,
  Minus,
  X,
} from 'lucide-react'
import '../workstation-window.css'

export type WorkstationWindowMode=
  | 'minimized'
  | 'split'
  | 'maximized'

type Props={
  title:string
  subtitle?:string
  badge?:string
  url?:string
  children?:ReactNode
  mode:WorkstationWindowMode
  onModeChange:(mode:WorkstationWindowMode)=>void
  onClose:()=>void
}

export default function WorkstationWindow({
  title,
  subtitle,
  badge='WORKSTATION WINDOW',
  url,
  children,
  mode,
  onModeChange,
  onClose,
}:Props){
  return (
    <section
      className="workstationManagedWindow glassCard"
      data-mode={mode}
      aria-label={title}
    >
      <header className="workstationManagedWindowHeader">
        <div className="workstationManagedWindowIdentity">
          <span className="eyebrow">
            {badge}
          </span>

          <strong>
            {title}
          </strong>

          {subtitle&&
            <small>
              {subtitle}
            </small>
          }
        </div>

        <div
          className="workstationManagedWindowControls"
          aria-label={`${title} window controls`}
        >
          <button
            type="button"
            title="Minimize"
            aria-label={`Minimize ${title}`}
            className={
              mode==='minimized'
                ? 'active'
                : ''
            }
            onClick={()=>{
              onModeChange('minimized')
            }}
          >
            <Minus size={16}/>
          </button>

          <button
            type="button"
            title="Split half screen"
            aria-label={`Show ${title} at half screen`}
            className={
              mode==='split'
                ? 'active'
                : ''
            }
            onClick={()=>{
              onModeChange('split')
            }}
          >
            <Columns2 size={16}/>
          </button>

          <button
            type="button"
            title={
              mode==='maximized'
                ? 'Restore half screen'
                : 'Maximize'
            }
            aria-label={
              mode==='maximized'
                ? `Restore ${title}`
                : `Maximize ${title}`
            }
            className={
              mode==='maximized'
                ? 'active'
                : ''
            }
            onClick={()=>{
              onModeChange(
                mode==='maximized'
                  ? 'split'
                  : 'maximized'
              )
            }}
          >
            {mode==='maximized'
              ? <Minimize2 size={16}/>
              : <Maximize2 size={16}/>
            }
          </button>

          <button
            type="button"
            title="Close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X size={16}/>
          </button>
        </div>
      </header>

      <div className="workstationManagedWindowBody">
        {url
          ? (
            <>
              <div className="workstationExternalBoundary">
                This service is contained inside the RideArrivo
                workstation. Provider authentication, framing,
                CSP and browser-security policies remain in force.
              </div>

              <iframe
                title={title}
                src={url}
                sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </>
          )
          : children
        }
      </div>
    </section>
  )
}

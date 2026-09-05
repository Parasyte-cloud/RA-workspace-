import { useState } from 'react'
import {
  Columns2,
  Maximize2,
  ShieldCheck,
} from 'lucide-react'
import WorkstationWindow, {
  type WorkstationWindowMode,
} from '../components/WorkstationWindow'
import '../workflow-unification.css'

const PROVIDUS_URL=
  'https://ibank.providusbank.com/provipay#/login'

export default function ProvidusBankingPanel({
  context='finance',
}:{
  context?:'finance'|'admin'
}){
  const [open,setOpen]=useState(false)
  const [mode,setMode]=
    useState<WorkstationWindowMode>('split')

  const launch=(
    nextMode:WorkstationWindowMode
  )=>{
    setMode(nextMode)
    setOpen(true)
  }

  return (
    <>
      <section className="providusBanking glassCard">
        <div className="providusBankingCopy">
          <span className="eyebrow">
            BANKING
          </span>

          <h3>
            Providus Corporate Banking
          </h3>

          <p>
            {context==='admin'
              ? 'Access authorised RideArrivo corporate banking from Administration Payments while keeping the Administration workstation open.'
              : 'Access authorised RideArrivo corporate banking while keeping Finance reconciliation, payments and records visible.'
            }
          </p>

          <div className="providusNotice">
            <ShieldCheck size={14}/>
            {' '}
            Banking credentials, passwords, PINs and OTPs are
            entered only into the secured Providus Bank service.
            RideArrivo Workspace does not store them.
          </div>
        </div>

        <div className="providusActions">
          <button
            type="button"
            className="primaryButton"
            onClick={()=>{
              launch('split')
            }}
          >
            <Columns2 size={17}/>
            Open half screen
          </button>

          <button
            type="button"
            className="glassButton"
            onClick={()=>{
              launch('maximized')
            }}
          >
            <Maximize2 size={17}/>
            Open full workspace
          </button>
        </div>
      </section>

      {open&&
        <WorkstationWindow
          title="Providus Corporate Banking"
          subtitle={
            context==='admin'
              ? 'Administration · Payments'
              : 'Finance · Banking'
          }
          badge="SECURE BANKING"
          url={PROVIDUS_URL}
          mode={mode}
          onModeChange={setMode}
          onClose={()=>{
            setOpen(false)
          }}
        />
      }
    </>
  )
}

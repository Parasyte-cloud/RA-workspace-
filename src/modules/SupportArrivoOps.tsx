import { useState } from 'react'
import { Route, UsersRound } from 'lucide-react'

import '../arrivoops.css'
import WorkstationWindow, {
  type WorkstationWindowMode,
} from '../components/WorkstationWindow'

/*
 * ArrivoOps for Support: the live console (riders, rides, drivers, panic
 * alerts, flight issues, live map) opened inside the workspace.
 *
 * Support staff sign in with their own ArrivoOps support account. The console
 * and the ArrivoOps backend keep support read only: riders can be viewed but
 * ID checks and wallet changes stay with admins.
 *
 * PArAsYtE
 */
const CONSOLE_URL = 'https://admin.ridearrivo.com/'

export default function SupportArrivoOps() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<WorkstationWindowMode>('split')

  return (
    <div className="arrivoOps supportArrivoOps arrivoOpsQuickGrid">
      <article className="glassCard arrivoOpsQuickCard">
        <Route />
        <div>
          <span className="eyebrow">ARRIVOOPS</span>
          <h3>Live Dispatch</h3>
          <p>
            Live bookings, rides, drivers, panic alerts, flight issues and the live
            map. Sign in with your ArrivoOps support account. Everything here is
            read only.
          </p>
        </div>
        <button
          type="button"
          className="primaryButton arrivoOpsLaunch"
          onClick={() => {
            setMode('split')
            setOpen(true)
          }}
        >
          Open live operations
        </button>
      </article>

      <article className="glassCard arrivoOpsQuickCard">
        <UsersRound />
        <div>
          <span className="eyebrow">RIDERS</span>
          <h3>Rider accounts</h3>
          <p>
            Open Live Dispatch and choose Riders to see every rider with their
            rides, spend and ID status. You can look, but not change anything.
          </p>
        </div>
        <button
          type="button"
          className="glassButton"
          onClick={() => {
            setMode('split')
            setOpen(true)
          }}
        >
          Open riders
        </button>
      </article>

      {open && (
        <WorkstationWindow
          title="ArrivoOps Live Dispatch"
          subtitle="Live bookings, riders, drivers, trips and operational status."
          badge="ARRIVOOPS"
          url={CONSOLE_URL}
          mode={mode}
          onModeChange={setMode}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

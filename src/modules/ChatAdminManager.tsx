import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  RefreshCw,
  ShieldCheck,
  ShieldPlus,
  UserMinus,
  Users,
} from 'lucide-react'

import { supabase } from '../lib/supabase'

type EmployeeOption = {
  id:string
  full_name:string
  email:string
  role:string
  department:string
  active:boolean
}

type EffectiveChatAdmin = {
  employee_id:string
  full_name:string
  email:string
  role:string
  department:string
  authority_source:
    | 'workspace_admin'
    | 'hr'
    | 'delegated'
    | string
  granted_by:string|null
  granted_by_name:string|null
  granted_at:string|null
  revocable:boolean
}

type ChatAdminManagerProps = {
  employees:EmployeeOption[]
}

function authorityLabel(
  source:EffectiveChatAdmin['authority_source'],
){
  switch(source){
    case 'workspace_admin':
      return 'Workspace Admin'
    case 'hr':
      return 'HR'
    case 'delegated':
      return 'Delegated Chat Admin'
    default:
      return 'Chat Admin'
  }
}

function displayName(
  row:{
    full_name?:string|null
    email?:string|null
  },
){
  return (
    row.full_name?.trim() ||
    row.email?.trim() ||
    'RideArrivo employee'
  )
}

export default function ChatAdminManager({
  employees,
}:ChatAdminManagerProps){
  const [admins,setAdmins]=
    useState<EffectiveChatAdmin[]>([])

  const [selectedEmployeeId,setSelectedEmployeeId]=
    useState('')

  const [loading,setLoading]=
    useState(true)

  const [busy,setBusy]=
    useState(false)

  const [message,setMessage]=
    useState('')

  const loadAdmins=
    useCallback(async(clearMessage=true)=>{
      if(!supabase){
        setAdmins([])
        setMessage(
          'Supabase is not configured.',
        )
        setLoading(false)
        return
      }

      setLoading(true)
      if(clearMessage) setMessage('')

      try{
        const {data,error}=
          await supabase.rpc(
            'list_workspace_chat_admins',
          )

        if(error) throw error

        setAdmins(
          Array.isArray(data)
            ? data as EffectiveChatAdmin[]
            : [],
        )
      }catch(error){
        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load Chat administrators.',
        )
      }finally{
        setLoading(false)
      }
    },[])

  useEffect(()=>{
    void loadAdmins()
  },[loadAdmins])

  const adminIds=
    useMemo(
      ()=>new Set(
        admins.map(
          admin=>admin.employee_id,
        ),
      ),
      [admins],
    )

  const candidates=
    useMemo(
      ()=>employees
        .filter(employee=>
          employee.active &&
          !adminIds.has(employee.id)
        )
        .sort((a,b)=>
          displayName(a).localeCompare(
            displayName(b),
          )
        ),
      [employees,adminIds],
    )

  async function grant(){
    if(
      !supabase ||
      !selectedEmployeeId ||
      busy
    ){
      return
    }

    const employee=
      employees.find(
        candidate=>
          candidate.id===
          selectedEmployeeId,
      )

    const confirmed=
      window.confirm(
        `Grant global Chat administrator access to ${displayName(employee || {})}?`,
      )

    if(!confirmed) return

    setBusy(true)
    setMessage('')

    try{
      const {error}=
        await supabase.rpc(
          'grant_workspace_chat_admin',
          {
            p_employee_id:
              selectedEmployeeId,
          },
        )

      if(error) throw error

      setSelectedEmployeeId('')

      setMessage(
        `${displayName(employee || {})} can now administer governed Chat rooms.`,
      )

      await loadAdmins(false)
    }catch(error){
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to grant Chat administrator access.',
      )
    }finally{
      setBusy(false)
    }
  }

  async function revoke(
    admin:EffectiveChatAdmin,
  ){
    if(
      !supabase ||
      !admin.revocable ||
      busy
    ){
      return
    }

    const confirmed=
      window.confirm(
        `Revoke delegated Chat administrator access from ${displayName(admin)}?`,
      )

    if(!confirmed) return

    setBusy(true)
    setMessage('')

    try{
      const {error}=
        await supabase.rpc(
          'revoke_workspace_chat_admin',
          {
            p_employee_id:
              admin.employee_id,
          },
        )

      if(error) throw error

      setMessage(
        `${displayName(admin)} no longer has delegated Chat administrator access.`,
      )

      await loadAdmins(false)
    }catch(error){
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to revoke Chat administrator access.',
      )
    }finally{
      setBusy(false)
    }
  }

  return (
    <section className="chatAdminManager glassCard">
      <div className="chatAdminManagerHead">
        <div>
          <span className="eyebrow">
            CHAT GOVERNANCE
          </span>

          <h3>
            Chat Administration
          </h3>

          <p>
            Control who can create and administer
            governed Project, Committee and Restricted
            rooms. Department rooms remain synchronized
            automatically.
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          disabled={loading || busy}
          onClick={()=>
            void loadAdmins()
          }
        >
          <RefreshCw
            size={15}
            className={
              loading
                ? 'spin'
                : undefined
            }
          />
          Refresh
        </button>
      </div>

      {message && (
        <div
          className="moduleNotice"
          role="status"
        >
          {message}
        </div>
      )}

      <div className="chatAdminGrantPanel">
        <div className="chatAdminGrantIcon">
          <ShieldPlus size={21}/>
        </div>

        <div className="chatAdminGrantCopy">
          <strong>
            Grant Chat administrator
          </strong>

          <span>
            Only active employees can receive
            delegated global Chat authority.
          </span>
        </div>

        <select
          value={selectedEmployeeId}
          disabled={busy || loading}
          aria-label="Employee to grant Chat administrator access"
          onChange={event=>
            setSelectedEmployeeId(
              event.target.value,
            )
          }
        >
          <option value="">
            Select employee
          </option>

          {candidates.map(employee=>(
            <option
              key={employee.id}
              value={employee.id}
            >
              {displayName(employee)}
              {employee.department
                ? ` · ${employee.department}`
                : ''}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="primaryButton"
          disabled={
            busy ||
            loading ||
            !selectedEmployeeId
          }
          onClick={()=>
            void grant()
          }
        >
          <ShieldCheck size={16}/>
          {busy
            ? 'Updating...'
            : 'Grant access'}
        </button>
      </div>

      <div className="chatAdminDirectory">
        <div className="chatAdminDirectoryHead">
          <div>
            <Users size={18}/>

            <div>
              <strong>
                Current Chat administrators
              </strong>

              <span>
                {loading
                  ? 'Loading...'
                  : `${admins.length} effective administrator${admins.length===1?'':'s'}`}
              </span>
            </div>
          </div>
        </div>

        {!loading && admins.length===0 && (
          <div className="chatAdminEmpty">
            No effective Chat administrators found.
          </div>
        )}

        {admins.map(admin=>(
          <article
            key={`${admin.employee_id}-${admin.authority_source}`}
            className="chatAdminRow"
          >
            <div className="chatAdminAvatar">
              {displayName(admin)
                .split(/\s+/)
                .slice(0,2)
                .map(part=>part[0])
                .join('')
                .toUpperCase()}
            </div>

            <div className="chatAdminPerson">
              <strong>
                {displayName(admin)}
              </strong>

              <span>
                {admin.email}
              </span>

              <small>
                {admin.department || 'No department'}
              </small>
            </div>

            <div className="chatAdminAuthority">
              <span
                className={
                  `chatAdminAuthorityPill ${admin.authority_source}`
                }
              >
                {authorityLabel(
                  admin.authority_source,
                )}
              </span>

              {admin.authority_source==='delegated' &&
                admin.granted_by_name && (
                  <small>
                    Granted by{' '}
                    {admin.granted_by_name}
                  </small>
                )}
            </div>

            {admin.revocable ? (
              <button
                type="button"
                className="glassButton danger"
                disabled={busy}
                onClick={()=>
                  void revoke(admin)
                }
              >
                <UserMinus size={15}/>
                Revoke
              </button>
            ) : (
              <span
                className="chatAdminBuiltIn"
                title="This authority comes from the employee's company role."
              >
                <ShieldCheck size={14}/>
                Built in
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

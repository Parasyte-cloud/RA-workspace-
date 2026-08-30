import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  CheckCircle2,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react'

import { supabase } from '../lib/supabase'

type AccessUser = {
  id:string
  email:string
  full_name:string
  role:string
  department:string
  job_title:string
  manager_id:string|null
  active:boolean
  created_at:string
  last_sign_in_at:string|null
  email_confirmed:boolean
}

const ROLE_OPTIONS = [
  'employee',
  'support',
  'engineer',
  'cto',
  'hr',
  'legal',
  'operations',
  'finance',
  'marketing',
  'partnerships',
  'manager',
  'admin',
]

const DEPARTMENTS = [
  'Administration',
  'Support',
  'Engineering',
  'People & HR',
  'Legal',
  'Operations',
  'Finance',
  'Marketing',
  'Partnerships',
  'Executive',
]

async function invokeAdmin(
  payload:Record<string,unknown>
){
  if(!supabase){
    throw new Error(
      'Supabase is not configured.'
    )
  }

  const {
    data:{session},
    error:sessionError,
  } =
    await supabase.auth.getSession()

  if(
    sessionError ||
    !session?.access_token
  ){
    throw new Error(
      'Your administrator session has expired. Sign in again.'
    )
  }

  const endpoint =
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspace-user-admin`

  const response =
    await fetch(
      endpoint,
      {
        method:'POST',

        headers:{
          'Content-Type':
            'application/json',

          'Authorization':
            `Bearer ${session.access_token}`,

          'apikey':
            import.meta.env
              .VITE_SUPABASE_ANON_KEY,
        },

        body:
          JSON.stringify(payload),
      }
    )

  let result:any = null

  try{
    result =
      await response.json()
  }catch{
    result = null
  }

  if(!response.ok){
    throw new Error(
      result?.error ||
      result?.message ||
      `Administrator request failed (${response.status}).`
    )
  }

  if(result?.error){
    throw new Error(
      result.error
    )
  }

  return result
}

export default function AdminAccessManager(){
  const [users,setUsers]=
    useState<AccessUser[]>([])

  const [loading,setLoading]=
    useState(true)

  const [message,setMessage]=
    useState('')

  const [filter,setFilter]=
    useState<
      'pending'|'active'|'all'
    >('pending')

  const loadUsers=
    useCallback(async()=>{
      setLoading(true)
      setMessage('')

      try{
        const data =
          await invokeAdmin({
            action:'list',
          })

        setUsers(
          Array.isArray(data?.users)
            ? data.users
            : []
        )
      }catch(error:any){
        setMessage(
          error?.message ||
          'Unable to load employee access.'
        )
      }finally{
        setLoading(false)
      }
    },[])

  useEffect(()=>{
    void loadUsers()
  },[loadUsers])

  const visible=
    useMemo(()=>{
      if(filter==='pending'){
        return users.filter(
          user=>!user.active
        )
      }

      if(filter==='active'){
        return users.filter(
          user=>user.active
        )
      }

      return users
    },[users,filter])

  const updateLocal=(
    id:string,
    patch:Partial<AccessUser>
  )=>{
    setUsers(current=>
      current.map(user=>
        user.id===id
          ? {...user,...patch}
          : user
      )
    )
  }

  const approve=async(
    user:AccessUser
  )=>{
    setMessage('')

    try{
      await invokeAdmin({
        action:'approve',
        userId:user.id,
        fullName:user.full_name,
        role:user.role,
        department:user.department,
        jobTitle:user.job_title,
        managerId:user.manager_id || null,
      })

      setMessage(
        `${user.full_name || user.email} approved successfully.`
      )

      await loadUsers()
    }catch(error:any){
      setMessage(
        error?.message ||
        'Approval failed.'
      )
    }
  }

  const sendPasswordReset=async(
    user:AccessUser
  )=>{
    const confirmed=window.confirm(
      `Send a secure password recovery email to ${user.email}?`
    )
    if(!confirmed) return

    setMessage('')
    try{
      await invokeAdmin({
        action:'password-reset',
        userId:user.id,
      })
      setMessage(`Password recovery email sent to ${user.email}.`)
    }catch(error:any){
      setMessage(error?.message || 'Unable to send password recovery email.')
    }
  }

  const revoke=async(
    user:AccessUser
  )=>{
    const confirmed =
      window.confirm(
        `Revoke workspace access for ${user.full_name || user.email}?`
      )

    if(!confirmed) return

    setMessage('')

    try{
      await invokeAdmin({
        action:'revoke',
        userId:user.id,
      })

      setMessage(
        `${user.full_name || user.email} access revoked.`
      )

      await loadUsers()
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to revoke access.'
      )
    }
  }

  const pendingCount =
    users.filter(
      user=>!user.active
    ).length

  return (
    <section
      className="adminAccessCard glassCard"
    >
      <div className="adminAccessHeader">
        <div>
          <span className="eyebrow">
            IDENTITY & ACCESS
          </span>

          <h3>
            Employee Access
          </h3>

          <p>
            Review RideArrivo employee
            sign-ins, assign their role and
            department, approve access or
            revoke existing access.
          </p>
        </div>

        <div className="adminAccessActions">
          {pendingCount>0 &&
            <span className="adminPendingBadge">
              {pendingCount} pending
            </span>
          }

          <button
            className="glassButton"
            onClick={()=>
              void loadUsers()
            }
            disabled={loading}
          >
            <RefreshCw size={16}/>
            Refresh
          </button>
        </div>
      </div>

      <div className="adminAccessTabs">
        <button
          className={
            filter==='pending'
              ? 'active'
              : ''
          }
          onClick={()=>
            setFilter('pending')
          }
        >
          Pending
          {pendingCount>0 &&
            <span>{pendingCount}</span>
          }
        </button>

        <button
          className={
            filter==='active'
              ? 'active'
              : ''
          }
          onClick={()=>
            setFilter('active')
          }
        >
          Approved
        </button>

        <button
          className={
            filter==='all'
              ? 'active'
              : ''
          }
          onClick={()=>
            setFilter('all')
          }
        >
          All accounts
        </button>
      </div>

      {message &&
        <div className="moduleNotice">
          {message}
        </div>
      }

      {loading ? (
        <div className="adminAccessEmpty">
          Loading employee accounts...
        </div>
      ) : visible.length===0 ? (
        <div className="adminAccessEmpty">
          <CheckCircle2 size={26}/>
          <strong>
            No accounts in this view
          </strong>
        </div>
      ) : (
        <div className="adminAccessList">
          {visible.map(user=>(
            <article
              className="adminAccessUser"
              key={user.id}
            >
              <div className="adminAccessIdentity">
                <div className="adminUserAvatar">
                  {(
                    user.full_name ||
                    user.email
                  )
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0,2)
                    .map(value=>
                      value[0]?.toUpperCase()
                    )
                    .join('')
                    .slice(0,2)}
                </div>

                <div>
                  <strong>
                    {user.full_name ||
                     'Unnamed employee'}
                  </strong>

                  <span>
                    {user.email}
                  </span>

                  <small>
                    {user.last_sign_in_at
                      ? `Last sign-in ${new Date(
                          user.last_sign_in_at
                        ).toLocaleString()}`
                      : 'No successful sign-in recorded'
                    }
                  </small>
                </div>
              </div>

              <div className="adminAccessFields">
                <label>
                  Full name
                  <input
                    value={user.full_name}
                    onChange={event=>
                      updateLocal(
                        user.id,
                        {
                          full_name:
                            event.target.value
                        }
                      )
                    }
                  />
                </label>

                <label>
                  Department
                  <select
                    value={user.department}
                    onChange={event=>
                      updateLocal(
                        user.id,
                        {
                          department:
                            event.target.value
                        }
                      )
                    }
                  >
                    <option value="Unassigned">
                      Unassigned
                    </option>

                    {DEPARTMENTS.map(
                      department=>(
                        <option
                          key={department}
                          value={department}
                        >
                          {department}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label>
                  Role
                  <select
                    value={user.role}
                    onChange={event=>
                      updateLocal(
                        user.id,
                        {
                          role:
                            event.target.value
                        }
                      )
                    }
                  >
                    {ROLE_OPTIONS.map(
                      role=>(
                        <option
                          key={role}
                          value={role}
                        >
                          {role}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label>
                  Job title
                  <input
                    value={user.job_title}
                    onChange={event=>
                      updateLocal(
                        user.id,
                        {
                          job_title:
                            event.target.value
                        }
                      )
                    }
                  />
                </label>

                <label>
                  Reports to
                  <select
                    value={user.manager_id || ''}
                    onChange={event=>
                      updateLocal(
                        user.id,
                        {manager_id:event.target.value || null}
                      )
                    }
                  >
                    <option value="">No manager assigned</option>
                    {users
                      .filter(candidate=>
                        candidate.id!==user.id &&
                        candidate.active &&
                        ['manager','admin'].includes(candidate.role)
                      )
                      .map(candidate=>(
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.full_name || candidate.email}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="adminAccessFooter">
                <span
                  className={
                    user.active
                      ? 'adminStatus active'
                      : 'adminStatus pending'
                  }
                >
                  {user.active
                    ? <ShieldCheck size={14}/>
                    : <UserCheck size={14}/>
                  }

                  {user.active
                    ? 'Approved'
                    : 'Awaiting approval'
                  }
                </span>

                <div className="buttonRow">
                  {!user.active &&
                    <button
                      className="primaryButton"
                      onClick={()=>
                        void approve(user)
                      }
                    >
                      <UserCheck size={16}/>
                      Approve access
                    </button>
                  }

                  {user.active &&
                    <button
                      className="glassButton"
                      onClick={()=>
                        void approve(user)
                      }
                    >
                      Save changes
                    </button>
                  }

                  {user.active &&
                    <button
                      className="glassButton"
                      onClick={()=>void sendPasswordReset(user)}
                    >
                      <KeyRound size={16}/>
                      Send password reset
                    </button>
                  }

                  {user.active &&
                    <button
                      className="dangerButton"
                      onClick={()=>
                        void revoke(user)
                      }
                    >
                      <UserX size={16}/>
                      Revoke
                    </button>
                  }
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

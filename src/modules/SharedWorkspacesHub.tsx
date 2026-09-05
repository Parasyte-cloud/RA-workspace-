import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  Archive,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  FolderKanban,
  LogOut,
  Mail,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  UserMinus,
  UserPlus,
  UsersRound,
  X
} from 'lucide-react'

import { supabase } from '../lib/supabase'

import '../shared-workspaces.css'
import '../workflow-unification.css'


type Profile={
  id:string
  full_name:string
  email:string
  role:string
  department:string|null
  job_title:string|null
}

type Space={
  id:string
  name:string
  description:string|null
  space_type:'department'|'project'|'cross_department'
  home_department:string|null
  created_by:string
  archived_at:string|null
  created_at:string
  updated_at:string
}

type Member={
  space_id:string
  user_id:string
  member_role:'owner'|'admin'|'member'|'viewer'
  added_by:string|null
  joined_at:string
}

type Invite={
  id:string
  space_id:string
  inviter_id:string
  invitee_id:string
  message:string|null
  status:'pending'|'accepted'|'declined'|'cancelled'
  created_at:string
  responded_at:string|null
}

type Message={
  id:string
  space_id:string
  author_id:string
  body:string
  created_at:string
  updated_at:string
}


const quickTools=[
  {target:'tasks',label:'Tasks & Approvals',Icon:FolderKanban},
  {target:'calendar',label:'Calendar',Icon:CalendarDays},
  {target:'files',label:'Company Files',Icon:FileText},
  {target:'mail',label:'Mail',Icon:Mail}
]

type Props={
  embedded?:boolean
  onNavigate?:(target:string)=>void
}


function formatDate(value:string){
  return new Intl.DateTimeFormat(
    undefined,
    {
      day:'2-digit',
      month:'short',
      year:'numeric'
    }
  ).format(new Date(value))
}


function formatTime(value:string){
  return new Intl.DateTimeFormat(
    undefined,
    {
      day:'2-digit',
      month:'short',
      hour:'2-digit',
      minute:'2-digit'
    }
  ).format(new Date(value))
}


function initials(value:string){
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0,2)
    .map(part=>part[0]?.toUpperCase() || '')
    .join('') || 'RA'
}


export default function SharedWorkspacesHub({
  embedded=false,
  onNavigate
}:Props){

  const [profile,setProfile]=useState<Profile|null>(null)
  const [people,setPeople]=useState<Profile[]>([])
  const [spaces,setSpaces]=useState<Space[]>([])
  const [members,setMembers]=useState<Member[]>([])
  const [invites,setInvites]=useState<Invite[]>([])
  const [messages,setMessages]=useState<Message[]>([])

  const [selectedSpaceId,setSelectedSpaceId]=useState('')
  const [newName,setNewName]=useState('')
  const [newDescription,setNewDescription]=useState('')
  const [newType,setNewType]=useState<'project'|'cross_department'>('project')
  const [partnerDepartment,setPartnerDepartment]=useState('')
  const [inviteeId,setInviteeId]=useState('')
  const [inviteMessage,setInviteMessage]=useState('')
  const [messageText,setMessageText]=useState('')

  const [loading,setLoading]=useState(true)
  const [refreshing,setRefreshing]=useState(false)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')

  const baseRequestRef=useRef(0)
  const spaceRequestRef=useRef(0)
  const hasLoadedBaseRef=useRef(false)

  const loadBase=useCallback(async()=>{
    const client=supabase

    if(!client){
      setLoading(false)
      setRefreshing(false)
      return
    }

    const requestSequence=++baseRequestRef.current

    if(hasLoadedBaseRef.current){
      setRefreshing(true)
    }else{
      setLoading(true)
    }

    setNotice('')

    try{
      const {
        data:{user},
        error:userError
      }=await client.auth.getUser()

      if(userError){
        throw userError
      }

      if(!user){
        throw new Error('Your workspace session has expired.')
      }

      const [profileResult,peopleResult,spaceResult,inviteResult]=
        await Promise.all([
          client
            .from('employee_profiles')
            .select('id,full_name,email,role,department,job_title')
            .eq('id',user.id)
            .maybeSingle(),
          client
            .from('employee_profiles')
            .select('id,full_name,email,role,department,job_title')
            .eq('active',true)
            .order('full_name'),
          client
            .from('collaboration_spaces')
            .select('id,name,description,space_type,home_department,created_by,archived_at,created_at,updated_at')
            .is('archived_at',null)
            .order('updated_at',{ascending:false}),
          client
            .from('collaboration_invites')
            .select('id,space_id,inviter_id,invitee_id,message,status,created_at,responded_at')
            .or(`invitee_id.eq.${user.id},inviter_id.eq.${user.id}`)
            .order('created_at',{ascending:false})
        ])

      if(requestSequence!==baseRequestRef.current){
        return
      }

      if(profileResult.error){
        throw profileResult.error
      }

      if(peopleResult.error){
        throw peopleResult.error
      }

      if(spaceResult.error){
        throw spaceResult.error
      }

      if(inviteResult.error){
        throw inviteResult.error
      }

      if(!profileResult.data){
        throw new Error('Employee profile not found.')
      }

      const currentProfile=profileResult.data as Profile
      const sharedSpaces=((spaceResult.data || []) as Space[])
        .filter(space=>space.space_type!=='department')

      setProfile(currentProfile)
      setPeople((peopleResult.data || []) as Profile[])
      setSpaces(sharedSpaces)
      setInvites((inviteResult.data || []) as Invite[])
      hasLoadedBaseRef.current=true

      setSelectedSpaceId(current=>{
        if(
          current &&
          sharedSpaces.some(space=>space.id===current)
        ){
          return current
        }

        return sharedSpaces[0]?.id || ''
      })
    }catch(error){
      if(requestSequence!==baseRequestRef.current){
        return
      }

      console.error('Shared workspaces load failed:',error)
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load shared workspaces.'
      )
    }finally{
      if(requestSequence===baseRequestRef.current){
        setLoading(false)
        setRefreshing(false)
      }
    }
  },[])

  const loadSpace=useCallback(async(spaceId:string)=>{
    const client=supabase
    const requestSequence=++spaceRequestRef.current

    if(!client || !spaceId){
      setMembers([])
      setMessages([])
      return
    }

    const [memberResult,messageResult]=await Promise.all([
      client
        .from('collaboration_space_members')
        .select('space_id,user_id,member_role,added_by,joined_at')
        .eq('space_id',spaceId)
        .order('joined_at'),
      client
        .from('collaboration_messages')
        .select('id,space_id,author_id,body,created_at,updated_at')
        .eq('space_id',spaceId)
        .order('created_at',{ascending:true})
        .limit(300)
    ])

    if(requestSequence!==spaceRequestRef.current){
      return
    }

    if(memberResult.error){
      setNotice(memberResult.error.message)
      return
    }

    if(messageResult.error){
      setNotice(messageResult.error.message)
      return
    }

    setMembers((memberResult.data || []) as Member[])
    setMessages((messageResult.data || []) as Message[])
  },[])

  useEffect(()=>{
    void loadBase()
    return()=>{
      baseRequestRef.current+=1
    }
  },[loadBase])

  useEffect(()=>{
    void loadSpace(selectedSpaceId)
    return()=>{
      spaceRequestRef.current+=1
    }
  },[selectedSpaceId,loadSpace])


  useEffect(()=>{
    const client=supabase

    const profileId=profile?.id

    if(!client || !profileId){
      return
    }

    const channel=client
      .channel(`shared-workspaces-${profileId}`)
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'collaboration_invites'
        },
        ()=>{
          void loadBase()
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'collaboration_messages'
        },
        payload=>{
          const row=(payload.new || payload.old) as Partial<Message>
          if(row.space_id===selectedSpaceId){
            void loadSpace(selectedSpaceId)
          }
        }
      )
      .subscribe()

    return()=>{
      void client.removeChannel(channel)
    }
  },[
    profile?.id,
    selectedSpaceId,
    loadBase,
    loadSpace
  ])


  const peopleMap=useMemo(()=>{
    return new Map(
      people.map(person=>[person.id,person])
    )
  },[people])


  const spaceMap=useMemo(()=>{
    return new Map(
      spaces.map(space=>[space.id,space])
    )
  },[spaces])


  const selectedSpace=useMemo(()=>{
    return spaces.find(space=>space.id===selectedSpaceId) || null
  },[spaces,selectedSpaceId])


  const incomingInvites=useMemo(()=>{
    if(!profile){
      return []
    }

    return invites.filter(invite=>
      invite.invitee_id===profile.id &&
      invite.status==='pending'
    )
  },[invites,profile])


  const outgoingInvites=useMemo(()=>{
    if(!profile || !selectedSpaceId){
      return []
    }

    return invites.filter(invite=>
      invite.inviter_id===profile.id &&
      invite.space_id===selectedSpaceId &&
      invite.status==='pending'
    )
  },[invites,profile,selectedSpaceId])


  const myMembership=useMemo(()=>{
    if(!profile){
      return null
    }

    return members.find(member=>member.user_id===profile.id) || null
  },[members,profile])


  const canManage=
    myMembership?.member_role==='owner' ||
    myMembership?.member_role==='admin'

  const canInvite=
    selectedSpace?.space_type==='project'
    && (
      canManage
      || myMembership?.member_role==='member'
    )


  const createSpace=async()=>{
    const client=supabase

    if(
      !client
      || !newName.trim()
      || (
        newType==='cross_department'
        && !partnerDepartment
      )
    ){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const response=
        newType==='cross_department'
          ? await client.rpc(
              'create_two_department_collaboration',
              {
                p_name:
                  newName.trim(),

                p_description:
                  newDescription.trim()
                  || null,

                p_partner_department:
                  partnerDepartment
              }
            )
          : await client.rpc(
              'create_collaboration_space',
              {
                p_name:
                  newName.trim(),

                p_description:
                  newDescription.trim()
                  || null,

                p_space_type:
                  'project'
              }
            )

      if(response.error){
        throw response.error
      }

      setNewName('')
      setNewDescription('')
      setPartnerDepartment('')

      setNotice(
        newType==='cross_department'
          ? 'Two-department collaboration created.'
          : 'Project workspace created.'
      )

      await loadBase()

      if(typeof response.data==='string'){
        setSelectedSpaceId(
          response.data
        )
      }
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to create shared workspace.'
      )
    }finally{
      setBusy(false)
    }
  }


  const inviteCollaborator=async()=>{
    const client=supabase

    if(!client || !selectedSpaceId || !inviteeId){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'invite_to_collaboration_space',
        {
          p_space_id:selectedSpaceId,
          p_invitee_id:inviteeId,
          p_message:inviteMessage.trim() || null
        }
      )

      if(error){
        throw error
      }

      setInviteeId('')
      setInviteMessage('')
      setNotice('Collaboration invitation sent.')
      await loadBase()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to invite collaborator.'
      )
    }finally{
      setBusy(false)
    }
  }


  const respondToInvite=async(
    inviteId:string,
    decision:'accepted'|'declined'
  )=>{
    const client=supabase

    if(!client){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'respond_to_collaboration_invite',
        {
          p_invite_id:inviteId,
          p_decision:decision
        }
      )

      if(error){
        throw error
      }

      setNotice(
        decision==='accepted'
          ? 'Workspace invitation accepted.'
          : 'Workspace invitation declined.'
      )
      await loadBase()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to respond to invitation.'
      )
    }finally{
      setBusy(false)
    }
  }


  const cancelInvite=async(inviteId:string)=>{
    const client=supabase

    if(!client){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'cancel_collaboration_invite',
        {p_invite_id:inviteId}
      )

      if(error){
        throw error
      }

      setNotice('Invitation cancelled.')
      await loadBase()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to cancel invitation.'
      )
    }finally{
      setBusy(false)
    }
  }


  const sendMessage=async()=>{
    const client=supabase

    if(
      !client ||
      !profile ||
      !selectedSpaceId ||
      !messageText.trim()
    ){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client
        .from('collaboration_messages')
        .insert({
          space_id:selectedSpaceId,
          author_id:profile.id,
          body:messageText.trim()
        })

      if(error){
        throw error
      }

      setMessageText('')
      await loadSpace(selectedSpaceId)
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to send message.'
      )
    }finally{
      setBusy(false)
    }
  }


  const leaveSpace=async()=>{
    const client=supabase

    if(!client || !selectedSpaceId){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'leave_collaboration_space',
        {p_space_id:selectedSpaceId}
      )

      if(error){
        throw error
      }

      setSelectedSpaceId('')
      setNotice('You left the shared workspace.')
      await loadBase()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to leave workspace.'
      )
    }finally{
      setBusy(false)
    }
  }


  const removeMember=async(userId:string)=>{
    const client=supabase

    if(!client || !selectedSpaceId){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'remove_collaboration_space_member',
        {
          p_space_id:selectedSpaceId,
          p_user_id:userId
        }
      )

      if(error){
        throw error
      }

      setNotice('Collaborator removed.')
      await loadSpace(selectedSpaceId)
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to remove collaborator.'
      )
    }finally{
      setBusy(false)
    }
  }


  const changeMemberRole=async(
    userId:string,
    role:Member['member_role']
  )=>{
    const client=supabase

    if(!client || !selectedSpaceId){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'set_collaboration_member_role',
        {
          p_space_id:selectedSpaceId,
          p_user_id:userId,
          p_member_role:role
        }
      )

      if(error){
        throw error
      }

      setNotice('Collaborator role updated.')
      await loadSpace(selectedSpaceId)
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to update collaborator role.'
      )
    }finally{
      setBusy(false)
    }
  }


  const archiveSpace=async()=>{
    const client=supabase

    if(!client || !selectedSpaceId){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const {error}=await client.rpc(
        'archive_collaboration_space',
        {p_space_id:selectedSpaceId}
      )

      if(error){
        throw error
      }

      setSelectedSpaceId('')
      setNotice('Shared workspace archived.')
      await loadBase()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to archive workspace.'
      )
    }finally{
      setBusy(false)
    }
  }


  const availableDepartments=useMemo(()=>{
    const ownDepartment=
      String(
        profile?.department || ''
      )
        .trim()
        .toLowerCase()

    const departments=
      new Map<string,string>()

    for(const person of people){
      const department=
        String(
          person.department || ''
        ).trim()

      if(
        !department
        || department.toLowerCase()===ownDepartment
      ){
        continue
      }

      departments.set(
        department.toLowerCase(),
        department
      )
    }

    return Array.from(
      departments.values()
    ).sort(
      (left,right)=>
        left.localeCompare(right)
    )
  },[
    people,
    profile
  ])


  const selectedDepartments=useMemo(()=>{
    const departments=
      new Set<string>()

    for(const member of members){
      const department=
        String(
          peopleMap.get(
            member.user_id
          )?.department || ''
        ).trim()

      if(department){
        departments.add(
          department
        )
      }
    }

    return Array.from(
      departments
    ).sort(
      (left,right)=>
        left.localeCompare(right)
    )
  },[
    members,
    peopleMap
  ])


  const availableInvitees=useMemo(()=>{
    const memberIds=
      new Set(
        members.map(
          member=>member.user_id
        )
      )

    const pendingIds=
      new Set(
        outgoingInvites.map(
          invite=>invite.invitee_id
        )
      )

    const ownDepartment=
      String(
        profile?.department || ''
      )
        .trim()
        .toLowerCase()

    return people.filter(person=>
      person.id!==profile?.id
      && String(
        person.department || ''
      )
        .trim()
        .toLowerCase()===ownDepartment
      && !memberIds.has(person.id)
      && !pendingIds.has(person.id)
    )
  },[
    people,
    profile,
    members,
    outgoingInvites
  ])


  if(loading && !hasLoadedBaseRef.current){
    return (
      <section className={`sharedHub ${embedded?'embedded':''}`}>
        <div className="glassCard sharedLoading">
          Loading shared workspaces...
        </div>
      </section>
    )
  }


  return (
    <section className={`sharedHub ${embedded?'embedded':''}`}>

      {!embedded &&
        <div className="sharedHero">
          <div>
            <span className="eyebrow">COLLABORATION</span>
            <h2>Shared Workspaces</h2>
            <p>
              Create private project rooms or governed
              two-department collaborations. Collaboration
              content follows explicit project membership
              or the two participating departments only.
            </p>
          </div>

          <div className="sharedHeroStats">
            <span><strong>{spaces.length}</strong><small>My workspaces</small></span>
            <span><strong>{incomingInvites.length}</strong><small>Pending invites</small></span>
            <span><strong>{people.length}</strong><small>Active employees</small></span>
          </div>
        </div>
      }


      {notice &&
        <div className="moduleNotice sharedNotice">
          {notice}
        </div>
      }


      {incomingInvites.length>0 &&
        <div className="sharedInviteTray glassCard">
          <div className="sharedSectionTitle">
            <div>
              <span className="eyebrow">INVITATIONS</span>
              <h3>Collaboration requests</h3>
            </div>
            <span className="sharedCount">{incomingInvites.length}</span>
          </div>

          <div className="sharedInviteGrid">
            {incomingInvites.map(invite=>{
              const inviter=peopleMap.get(invite.inviter_id)
              const space=spaceMap.get(invite.space_id)

              return (
                <article key={invite.id}>
                  <div>
                    <strong>{space?.name || 'Shared workspace'}</strong>
                    <span>
                      Invited by {inviter?.full_name || 'RideArrivo employee'}
                    </span>
                    {invite.message && <p>{invite.message}</p>}
                  </div>

                  <div className="sharedInviteActions">
                    <button
                      type="button"
                      className="primaryButton"
                      disabled={busy}
                      onClick={()=>void respondToInvite(invite.id,'accepted')}
                    >
                      <Check size={15}/>
                      Accept
                    </button>
                    <button
                      type="button"
                      className="glassButton"
                      disabled={busy}
                      onClick={()=>void respondToInvite(invite.id,'declined')}
                    >
                      <X size={15}/>
                      Decline
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      }


      {onNavigate &&
        <div className="sharedQuickTools glassCard">
          <div>
            <span className="eyebrow">WORK TOOLS</span>
            <strong>Keep collaboration connected to daily work</strong>
          </div>

          <div>
            {quickTools.map(({target,label,Icon})=>(
              <button
                type="button"
                key={target}
                onClick={()=>onNavigate(target)}
              >
                <Icon size={15}/>
                {label}
              </button>
            ))}
          </div>
        </div>
      }


      <div className="sharedLayout">

        <aside className="sharedSidebar">
          <div className="sharedCreate glassCard">
            <div className="sharedSectionTitle">
              <div>
                <span className="eyebrow">NEW WORKSPACE</span>
                <h3>Create shared workspace</h3>
              </div>
              <FolderKanban size={21}/>
            </div>

            <label>
              Workspace type
              <select
                value={newType}
                onChange={event=>setNewType(
                  event.target.value as 'project'|'cross_department'
                )}
              >
                <option value="project">Project</option>
                <option value="cross_department">Cross-department</option>
              </select>
            </label>
            {newType==='cross_department' &&
              <label>
                Partner department

                <select
                  value={partnerDepartment}
                  onChange={event=>{
                    setPartnerDepartment(
                      event.target.value
                    )
                  }}
                >
                  <option value="">
                    Select one department
                  </option>

                  {availableDepartments.map(
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
            }

            <label>
              Name
              <input
                value={newName}
                onChange={event=>setNewName(event.target.value)}
                placeholder="Corporate Airport Launch"
              />
            </label>

            <label>
              Purpose
              <textarea
                value={newDescription}
                onChange={event=>setNewDescription(event.target.value)}
                placeholder="What should this team accomplish?"
              />
            </label>

            <button
              type="button"
              className="primaryButton"
              disabled={
                busy
                || !newName.trim()
                || (
                  newType==='cross_department'
                  && !partnerDepartment
                )
              }
              onClick={()=>void createSpace()}
            >
              <FolderKanban size={16}/>
              Create workspace
            </button>
          </div>


          <div className="sharedSpaceList glassCard">
            <div className="sharedSectionTitle">
              <div>
                <span className="eyebrow">MY WORKSPACES</span>
                <h3>Projects</h3>
              </div>
              <button
                type="button"
                className="iconButton"
                title={refreshing?'Refreshing':'Refresh'}
                disabled={loading||refreshing}
                onClick={()=>void loadBase()}
              >
                <RefreshCw size={16}/>
              </button>
            </div>

            <div className="sharedSpaceCards">
              {spaces.map(space=>(
                <button
                  type="button"
                  key={space.id}
                  className={selectedSpaceId===space.id?'active':''}
                  onClick={()=>setSelectedSpaceId(space.id)}
                >
                  <span className="sharedSpaceIcon">
                    {space.space_type==='cross_department'
                      ? <UsersRound size={17}/>
                      : <FolderKanban size={17}/>
                    }
                  </span>
                  <span>
                    <strong>{space.name}</strong>
                    <small>
                      {space.space_type==='cross_department'
                        ? 'Cross-department'
                        : 'Project'}
                      {' · '}
                      {formatDate(space.created_at)}
                    </small>
                  </span>
                  <ChevronRight size={15}/>
                </button>
              ))}

              {spaces.length===0 &&
                <div className="sharedEmpty">
                  No shared workspaces yet. Create one or accept an invitation.
                </div>
              }
            </div>
          </div>
        </aside>


        <div className="sharedMain">
          {!selectedSpace &&
            <div className="sharedBlank glassCard">
              <FolderKanban size={32}/>
              <h3>Select a shared workspace</h3>
              <p>
                Choose an existing project or create a new one to start collaborating.
              </p>
            </div>
          }

          {selectedSpace && <>
            <div className="sharedWorkspaceHeader glassCard">
              <div>
                <span className="sharedType">
                  {selectedSpace.space_type==='cross_department'
                    ? 'CROSS-DEPARTMENT'
                    : 'PROJECT'}
                </span>
                <h3>{selectedSpace.name}</h3>
                <p>
                  {selectedSpace.description || 'Shared RideArrivo project workspace.'}
                </p>
              </div>

              <div className="sharedHeaderMeta">
                <span>
                  <UsersRound size={15}/>
                  {members.length} members
                </span>
                <span>
                  <ShieldCheck size={15}/>
                  {myMembership?.member_role || 'department member'}
                </span>
              </div>
            </div>


            <div className="sharedMembers glassCard">
              <div className="sharedSectionTitle">
                <div>
                  <span className="eyebrow">COLLABORATORS</span>
                  <h3>Workspace members</h3>
                </div>
              </div>

              <div className="sharedMemberList">
                {members.map(member=>{
                  const person=peopleMap.get(member.user_id)
                  const isSelf=member.user_id===profile?.id

                  return (
                    <article key={member.user_id}>
                      <div className="sharedMemberAvatar">
                        {initials(person?.full_name || 'RideArrivo')}
                      </div>

                      <div className="sharedMemberIdentity">
                        <strong>
                          {person?.full_name || 'RideArrivo employee'}
                          {isSelf?' (You)':''}
                        </strong>
                        <small>
                          {person?.job_title || person?.department || person?.role || 'Employee'}
                        </small>
                      </div>

                      {canManage && selectedSpace?.space_type==='project' && !isSelf
                        ? <div className="sharedMemberControls">
                            <select
                              value={member.member_role}
                              disabled={busy}
                              onChange={event=>void changeMemberRole(
                                member.user_id,
                                event.target.value as Member['member_role']
                              )}
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Workspace admin</option>
                              <option value="member">Member</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button
                              type="button"
                              className="iconButton danger"
                              title="Remove collaborator"
                              disabled={busy}
                              onClick={()=>void removeMember(member.user_id)}
                            >
                              <UserMinus size={15}/>
                            </button>
                          </div>
                        : <span className="sharedRoleBadge">
                            {member.member_role}
                          </span>
                      }
                    </article>
                  )
                })}
              </div>
            </div>


            {canInvite &&
              <div className="sharedInvitePanel glassCard">
                <div className="sharedSectionTitle">
                  <div>
                    <span className="eyebrow">INVITE</span>
                    <h3>Add an employee</h3>
                    <p>
                      Invite an active RideArrivo employee. Access begins only after acceptance.
                    </p>
                  </div>
                  <UserPlus size={20}/>
                </div>

                <div className="sharedInviteForm">
                  <select
                    value={inviteeId}
                    onChange={event=>setInviteeId(event.target.value)}
                  >
                    <option value="">Select employee</option>
                    {availableInvitees.map(person=>(
                      <option key={person.id} value={person.id}>
                        {person.full_name} · {person.department || person.role}
                      </option>
                    ))}
                  </select>

                  <input
                    value={inviteMessage}
                    onChange={event=>setInviteMessage(event.target.value)}
                    placeholder="Optional invitation note"
                  />

                  <button
                    type="button"
                    className="primaryButton"
                    disabled={busy || !inviteeId}
                    onClick={()=>void inviteCollaborator()}
                  >
                    <UserPlus size={16}/>
                    Send invite
                  </button>
                </div>

                {outgoingInvites.length>0 &&
                  <div className="sharedPendingInvites">
                    {outgoingInvites.map(invite=>{
                      const invitee=peopleMap.get(invite.invitee_id)
                      return (
                        <span key={invite.id}>
                          <strong>{invitee?.full_name || 'Employee'}</strong>
                          <small>Pending</small>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={()=>void cancelInvite(invite.id)}
                          >
                            Cancel
                          </button>
                        </span>
                      )
                    })}
                  </div>
                }
              </div>
            }


            {selectedSpace.space_type==='cross_department' &&
              <div className="sharedBoundaryNotice">
                <strong>
                  Two-department boundary
                </strong>
                <br/>
                {selectedDepartments.length===2
                  ? selectedDepartments.join(' + ')
                  : 'Exactly two participating departments'
                }.
                Access follows department membership.
                Individual invitations cannot add a third department.
              </div>
            }

            <div className="sharedDiscussion glassCard">
              <div className="sharedSectionTitle">
                <div>
                  <span className="eyebrow">DISCUSSION</span>
                  <h3>Project conversation</h3>
                </div>
                <MessageSquareText size={20}/>
              </div>

              <div className="sharedMessages">
                {messages.map(item=>{
                  const author=peopleMap.get(item.author_id)
                  const mine=item.author_id===profile?.id

                  return (
                    <article key={item.id} className={mine?'mine':''}>
                      <div>
                        <strong>{author?.full_name || 'RideArrivo employee'}</strong>
                        <small>{formatTime(item.created_at)}</small>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  )
                })}

                {messages.length===0 &&
                  <div className="sharedEmpty">
                    No discussion yet. Start the project conversation.
                  </div>
                }
              </div>

              <div className="sharedComposer">
                <textarea
                  value={messageText}
                  onChange={event=>setMessageText(event.target.value)}
                  placeholder="Write to the project team..."
                />
                <button
                  type="button"
                  className="primaryButton"
                  disabled={busy || !messageText.trim()}
                  onClick={()=>void sendMessage()}
                >
                  <Send size={16}/>
                  Send
                </button>
              </div>
            </div>


            <div className="sharedWorkspaceControls glassCard">
              <div>
                <strong>Workspace access</strong>
                <p>
                  Project access follows explicit membership; two-department collaboration access follows current department assignment.
                </p>
              </div>

              <div>
                {myMembership &&
                  selectedSpace?.space_type==='project' &&
                  <button
                    type="button"
                    className="glassButton"
                    disabled={busy}
                    onClick={()=>void leaveSpace()}
                  >
                    <LogOut size={15}/>
                    Leave workspace
                  </button>
                }

                {canManage &&
                  <button
                    type="button"
                    className="glassButton danger"
                    disabled={busy}
                    onClick={()=>void archiveSpace()}
                  >
                    <Archive size={15}/>
                    Archive workspace
                  </button>
                }
              </div>
            </div>
          </>}
        </div>
      </div>
    </section>
  )
}

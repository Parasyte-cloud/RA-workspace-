import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CircleX,
  Clock3,
  Download,
  Eye,
  FileText,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react'

import { supabase } from '../lib/supabase'


type Employee = {
  id:string
  full_name:string
  email:string
  department:string
  job_title:string
  role?:string
}


type Assignee = {
  assignee_id:string
  assigned_by:string
  assignee?:Employee|null
}


type Watcher = {
  user_id:string
  user?:Employee|null
}


type Comment = {
  id:string
  body:string
  created_at:string
  author_id:string
  author?:Employee|null
}


type Activity = {
  id:string
  action:string
  metadata:any
  created_at:string
  actor?:{
    full_name?:string
    email?:string
  }|null
}


type Attachment = {
  id:string
  file_name:string
  storage_path:string
  mime_type:string|null
  file_size:number|null
  created_at:string
  uploaded_by:string
}


type Approval = {
  id:string
  approver_id:string
  requested_by:string
  status:'pending'|'approved'|'rejected'|'cancelled'
  request_note:string|null
  decision_note:string|null
  requested_at:string
  decided_at:string|null
  approval_round:number
  approver?:Employee|null
  requester?:Employee|null
}


type DeadlineEvent = {
  id:string
  event_type:'due_24h'|'overdue'|'overdue_24h_escalation'
  created_at:string
}


type WorkItem = {
  id:string
  title:string
  description:string
  status:string
  priority:string
  department:string|null
  created_by:string
  due_at:string|null
  escalation_level?:number
  escalated_at?:string|null
  escalation_reason?:string|null
  work_item_assignees?:Assignee[]
}


export function WorkItemDetail({
  item,
  people,
  currentUserId,
  currentUserRole,
  onClose,
  onChanged
}:{
  item:WorkItem
  people:Employee[]
  currentUserId:string
  currentUserRole:string
  onClose:()=>void
  onChanged:()=>void
}){
  const [comments,setComments]=useState<Comment[]>([])
  const [watchers,setWatchers]=useState<Watcher[]>([])
  const [activity,setActivity]=useState<Activity[]>([])
  const [attachments,setAttachments]=useState<Attachment[]>([])
  const [approvals,setApprovals]=useState<Approval[]>([])
  const [deadlineEvents,setDeadlineEvents]=useState<DeadlineEvent[]>([])
  const [approvalCandidates,setApprovalCandidates]=useState<Employee[]>([])
  const detailRequestRef=useRef(0)

  const [comment,setComment]=useState('')
  const [newAssignee,setNewAssignee]=useState('')
  const [newWatcher,setNewWatcher]=useState('')
  const [escalationReason,setEscalationReason]=useState('')
  const [selectedApprover,setSelectedApprover]=useState('')
  const [approvalNote,setApprovalNote]=useState('')
  const [decisionNotes,setDecisionNotes]=useState<Record<string,string>>({})

  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')


  const assignees=
    item.work_item_assignees || []

  const isManager=
    currentUserRole==='manager' ||
    currentUserRole==='admin'

  const canRequestApproval=
    item.created_by===currentUserId ||
    isManager


  const availableAssignees=useMemo(()=>{
    const existing=new Set(
      assignees.map(
        item=>item.assignee_id
      )
    )

    return people.filter(
      person=>!existing.has(person.id)
    )
  },[
    people,
    assignees
  ])


  const availableWatchers=useMemo(()=>{
    const existing=new Set(
      watchers.map(
        item=>item.user_id
      )
    )

    return people.filter(
      person=>!existing.has(person.id)
    )
  },[
    people,
    watchers
  ])


  const loadDetail=useCallback(async()=>{
    const client=supabase
    if(!client){
      return
    }

    const requestSequence=++detailRequestRef.current
    setLoading(true)
    setMessage('')

    try{
      const [
        commentsResult,
        watchersResult,
        activityResult,
        attachmentsResult,
        approvalsResult,
        deadlinesResult
      ]=await Promise.all([
        client
          .from('work_item_comments')
          .select(`
            id,
            body,
            created_at,
            author_id,
            author:employee_profiles!work_item_comments_author_id_fkey(
              id,
              full_name,
              email,
              department,
              job_title
            )
          `)
          .eq('work_item_id',item.id)
          .order('created_at',{ascending:true}),
        client
          .from('work_item_watchers')
          .select(`
            user_id,
            user:employee_profiles!work_item_watchers_user_id_fkey(
              id,
              full_name,
              email,
              department,
              job_title
            )
          `)
          .eq('work_item_id',item.id),
        client
          .from('work_item_activity')
          .select(`
            id,
            action,
            metadata,
            created_at,
            actor:employee_profiles!work_item_activity_actor_id_fkey(
              full_name,
              email
            )
          `)
          .eq('work_item_id',item.id)
          .order('created_at',{ascending:false}),
        client
          .from('work_item_attachments')
          .select(`
            id,
            file_name,
            storage_path,
            mime_type,
            file_size,
            created_at,
            uploaded_by
          `)
          .eq('work_item_id',item.id)
          .order('created_at',{ascending:false}),
        client
          .from('work_item_approvals')
          .select(`
            id,
            approver_id,
            requested_by,
            status,
            request_note,
            decision_note,
            requested_at,
            decided_at,
            approval_round,
            approver:employee_profiles!work_item_approvals_approver_id_fkey(
              id,
              full_name,
              email,
              department,
              job_title
            ),
            requester:employee_profiles!work_item_approvals_requested_by_fkey(
              id,
              full_name,
              email,
              department,
              job_title
            )
          `)
          .eq('work_item_id',item.id)
          .order('requested_at',{ascending:false}),
        client
          .from('work_item_deadline_events')
          .select('id,event_type,created_at')
          .eq('work_item_id',item.id)
          .order('created_at',{ascending:false})
      ])

      if(requestSequence!==detailRequestRef.current){
        return
      }

      const errors=[
        commentsResult.error,
        watchersResult.error,
        activityResult.error,
        attachmentsResult.error,
        approvalsResult.error,
        deadlinesResult.error
      ].filter(Boolean)

      if(errors.length){
        setMessage(errors[0]!.message)
      }

      if(!commentsResult.error){
        setComments(
          ((commentsResult.data || []) as unknown) as Comment[]
        )
      }

      if(!watchersResult.error){
        setWatchers(
          ((watchersResult.data || []) as unknown) as Watcher[]
        )
      }

      if(!activityResult.error){
        setActivity(
          ((activityResult.data || []) as unknown) as Activity[]
        )
      }

      if(!attachmentsResult.error){
        setAttachments(
          (attachmentsResult.data || []) as Attachment[]
        )
      }

      if(!approvalsResult.error){
        setApprovals(
          ((approvalsResult.data || []) as unknown) as Approval[]
        )
      }

      if(!deadlinesResult.error){
        setDeadlineEvents(
          (deadlinesResult.data || []) as DeadlineEvent[]
        )
      }

      if(canRequestApproval){
        const {data,error}=await client.rpc(
          'get_work_approval_candidates',
          {target_work_item:item.id}
        )

        if(requestSequence!==detailRequestRef.current){
          return
        }

        if(error){
          setMessage(error.message)
        }else{
          setApprovalCandidates(
            (data || []) as Employee[]
          )
        }
      }else{
        setApprovalCandidates([])
      }
    }finally{
      if(requestSequence===detailRequestRef.current){
        setLoading(false)
      }
    }
  },[
    item.id,
    canRequestApproval
  ])


  useEffect(()=>{
    void loadDetail()
    return()=>{
      detailRequestRef.current+=1
    }
  },[loadDetail])


  useEffect(()=>{
    if(!supabase){
      return
    }

    const client=supabase

    const channel=client
      .channel(
        `work-detail-${item.id}`
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'work_item_comments',
          filter:`work_item_id=eq.${item.id}`
        },
        ()=>{
          void loadDetail()
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'work_item_watchers',
          filter:`work_item_id=eq.${item.id}`
        },
        ()=>{
          void loadDetail()
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'work_item_approvals',
          filter:`work_item_id=eq.${item.id}`
        },
        ()=>{
          void loadDetail()
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'work_item_deadline_events',
          filter:`work_item_id=eq.${item.id}`
        },
        ()=>{
          void loadDetail()
        }
      )
      .subscribe()

    return()=>{
      void client.removeChannel(channel)
    }
  },[
    item.id,
    loadDetail
  ])


  const addComment=async()=>{
    if(
      !supabase ||
      !comment.trim()
    ){
      return
    }

    setBusy(true)
    setMessage('')

    const {error}=await supabase.rpc(
      'add_work_comment',
      {
        target_work_item:item.id,
        comment_body:comment.trim()
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      setComment('')
      await loadDetail()
    }

    setBusy(false)
  }


  const addAssignee=async()=>{
    if(
      !supabase ||
      !newAssignee
    ){
      return
    }

    setBusy(true)

    const {error}=await supabase.rpc(
      'add_work_assignee',
      {
        target_work_item:item.id,
        target_user:newAssignee
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      setNewAssignee('')
      await onChanged()
    }

    setBusy(false)
  }


  const addWatcher=async()=>{
    if(
      !supabase ||
      !newWatcher
    ){
      return
    }

    setBusy(true)

    const {error}=await supabase.rpc(
      'add_work_watcher',
      {
        target_work_item:item.id,
        target_user:newWatcher
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      setNewWatcher('')
      await loadDetail()
    }

    setBusy(false)
  }


  const escalate=async()=>{
    if(!supabase){
      return
    }

    setBusy(true)

    const {error}=await supabase.rpc(
      'escalate_work_item',
      {
        target_work_item:item.id,
        reason:escalationReason.trim()
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      setEscalationReason('')
      await onChanged()
      await loadDetail()
    }

    setBusy(false)
  }


  const requestApproval=async()=>{
    if(
      !supabase ||
      !selectedApprover ||
      !canRequestApproval
    ){
      return
    }

    setBusy(true)
    setMessage('')

    const {error}=await supabase.rpc(
      'request_work_approval',
      {
        target_work_item:item.id,
        target_approver:selectedApprover,
        note:approvalNote.trim() || null
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      setSelectedApprover('')
      setApprovalNote('')
      await onChanged()
      await loadDetail()
    }

    setBusy(false)
  }


  const decideApproval=async(
    approvalId:string,
    decision:'approved'|'rejected'
  )=>{
    if(!supabase){
      return
    }

    setBusy(true)
    setMessage('')

    const {error}=await supabase.rpc(
      'decide_work_approval',
      {
        target_approval:approvalId,
        decision,
        note:
          decisionNotes[approvalId]
            ?.trim() || null
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      setDecisionNotes(current=>{
        const next={...current}
        delete next[approvalId]
        return next
      })
      await onChanged()
      await loadDetail()
    }

    setBusy(false)
  }


  const cancelApproval=async(
    approvalId:string
  )=>{
    if(!supabase){
      return
    }

    setBusy(true)
    setMessage('')

    const {error}=await supabase.rpc(
      'cancel_work_approval',
      {
        target_approval:approvalId,
        note:
          decisionNotes[approvalId]
            ?.trim() || null
      }
    )

    if(error){
      setMessage(error.message)
    }else{
      await onChanged()
      await loadDetail()
    }

    setBusy(false)
  }


  const uploadFile=async(
    file:File
  )=>{
    if(!supabase){
      return
    }

    setBusy(true)
    setMessage('')

    try{
      const safeName=file.name
        .replace(
          /[^a-zA-Z0-9._-]/g,
          '-'
        )

      const path=[
        item.id,
        currentUserId,
        `${Date.now()}-${safeName}`
      ].join('/')

      const {error:uploadError}=
        await supabase.storage
          .from('work-attachments')
          .upload(
            path,
            file,
            {
              upsert:false,
              contentType:
                file.type ||
                'application/octet-stream'
            }
          )

      if(uploadError){
        throw uploadError
      }

      const {error:metadataError}=
        await supabase
          .from('work_item_attachments')
          .insert({
            work_item_id:item.id,
            uploaded_by:currentUserId,
            file_name:file.name,
            storage_path:path,
            mime_type:
              file.type || null,
            file_size:file.size
          })

      if(metadataError){
        await supabase.storage
          .from('work-attachments')
          .remove([path])

        throw metadataError
      }

      await loadDetail()

    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to upload attachment.'
      )
    }

    setBusy(false)
  }


  const downloadFile=async(
    attachment:Attachment
  )=>{
    if(!supabase){
      return
    }

    const {data,error}=
      await supabase.storage
        .from('work-attachments')
        .createSignedUrl(
          attachment.storage_path,
          60
        )

    if(error || !data?.signedUrl){
      setMessage(
        error?.message ||
        'Unable to open attachment.'
      )
      return
    }

    window.open(
      data.signedUrl,
      '_blank',
      'noopener,noreferrer'
    )
  }


  const formatSize=(size:number|null)=>{
    if(!size){
      return ''
    }

    if(size<1024){
      return `${size} B`
    }

    if(size<1024*1024){
      return `${Math.round(size/1024)} KB`
    }

    return `${(
      size/(1024*1024)
    ).toFixed(1)} MB`
  }


  return (
    <div className="workDetailBackdrop">
      <aside className="workDetailPanel">
        <div className="workDetailHeader">
          <div>
            <span className="eyebrow">
              {item.department ||
                'WORKSPACE'}
            </span>

            <h2>
              {item.title}
            </h2>
          </div>

          <button
            type="button"
            className="iconButton"
            onClick={onClose}
          >
            <X size={18}/>
          </button>
        </div>


        {message&&
          <div className="moduleNotice">
            {message}
          </div>
        }


        <div className="workDetailBody">
          <section className="workDetailSection">
            <h3>
              Details
            </h3>

            <p>
              {item.description ||
                'No description provided.'}
            </p>

            <div className="workDetailFacts">
              <span>
                Status
                <strong>
                  {item.status.replace(
                    /_/g,
                    ' '
                  )}
                </strong>
              </span>

              <span>
                Priority
                <strong>
                  {item.priority}
                </strong>
              </span>

              {item.due_at&&
                <span>
                  Due
                  <strong>
                    {new Date(
                      item.due_at
                    ).toLocaleString()}
                  </strong>
                </span>
              }

              <span>
                Escalation
                <strong>
                  Level {
                    item.escalation_level || 0
                  }
                </strong>
              </span>
            </div>

            {deadlineEvents.length>0&&
              <div className="workDeadlineEvents">
                {deadlineEvents.map(event=>
                  <span
                    key={event.id}
                    className={event.event_type}
                  >
                    <Clock3 size={13}/>
                    {event.event_type==='due_24h'
                      ? 'Due within 24 hours'
                      : event.event_type==='overdue'
                        ? 'Overdue alert sent'
                        : 'Automatically escalated'
                    }
                  </span>
                )}
              </div>
            }
          </section>


          <section className="workDetailSection">
            <div className="workDetailTitle">
              <h3>
                <Users size={17}/>
                Assignees
              </h3>
            </div>

            <div className="workPeopleList">
              {assignees.map(a=>
                <div key={a.assignee_id}>
                  <span>
                    <strong>
                      {a.assignee?.full_name ||
                        a.assignee?.email ||
                        'Employee'}
                    </strong>

                    <small>
                      {a.assignee?.department}
                    </small>
                  </span>

                  <Check size={16}/>
                </div>
              )}
            </div>

            <div className="workInlineAction">
              <select
                value={newAssignee}
                onChange={event=>
                  setNewAssignee(
                    event.target.value
                  )
                }
              >
                <option value="">
                  Add assignee...
                </option>

                {availableAssignees.map(person=>
                  <option
                    key={person.id}
                    value={person.id}
                  >
                    {person.full_name}
                    {' — '}
                    {person.department}
                  </option>
                )}
              </select>

              <button
                className="glassButton"
                disabled={
                  busy ||
                  !newAssignee
                }
                onClick={()=>
                  void addAssignee()
                }
              >
                <UserPlus size={16}/>
                Add
              </button>
            </div>
          </section>


          <section className="workDetailSection">
            <h3>
              <Eye size={17}/>
              Watchers
            </h3>

            <div className="workPeopleList">
              {watchers.map(w=>
                <div key={w.user_id}>
                  <span>
                    <strong>
                      {w.user?.full_name ||
                        w.user?.email ||
                        'Employee'}
                    </strong>

                    <small>
                      {w.user?.department}
                    </small>
                  </span>
                </div>
              )}

              {!watchers.length&&
                <small>
                  No watchers.
                </small>
              }
            </div>

            <div className="workInlineAction">
              <select
                value={newWatcher}
                onChange={event=>
                  setNewWatcher(
                    event.target.value
                  )
                }
              >
                <option value="">
                  Add watcher...
                </option>

                {availableWatchers.map(person=>
                  <option
                    key={person.id}
                    value={person.id}
                  >
                    {person.full_name}
                    {' — '}
                    {person.department}
                  </option>
                )}
              </select>

              <button
                className="glassButton"
                disabled={
                  busy ||
                  !newWatcher
                }
                onClick={()=>
                  void addWatcher()
                }
              >
                <Plus size={16}/>
                Add
              </button>
            </div>
          </section>


          <section className="workDetailSection">
            <h3>
              <Paperclip size={17}/>
              Attachments
            </h3>

            <label className="workUploadButton">
              <Paperclip size={16}/>
              Attach file

              <input
                type="file"
                disabled={busy}
                onChange={event=>{
                  const file=
                    event.target.files?.[0]

                  if(file){
                    void uploadFile(file)
                  }

                  event.currentTarget.value=''
                }}
              />
            </label>

            <div className="workAttachmentList">
              {attachments.map(file=>
                <button
                  type="button"
                  key={file.id}
                  onClick={()=>
                    void downloadFile(file)
                  }
                >
                  <FileText size={17}/>

                  <span>
                    <strong>
                      {file.file_name}
                    </strong>

                    <small>
                      {formatSize(
                        file.file_size
                      )}
                    </small>
                  </span>

                  <Download size={15}/>
                </button>
              )}

              {!attachments.length&&
                <small>
                  No attachments.
                </small>
              }
            </div>
          </section>


          <section className="workDetailSection workApprovalSection">
            <h3>
              <ShieldCheck size={17}/>
              Approvals
            </h3>

            <div className="workApprovalList">
              {approvals.map(approval=>{
                const canDecide=
                  approval.status==='pending' &&
                  (
                    approval.approver_id===currentUserId ||
                    isManager
                  )

                const canCancel=
                  approval.status==='pending' &&
                  (
                    approval.requested_by===currentUserId ||
                    isManager
                  )

                return (
                  <article
                    key={approval.id}
                    className={'workApproval '+approval.status}
                  >
                    <div className="workApprovalHeader">
                      <span>
                        {approval.status==='approved'
                          ? <BadgeCheck size={18}/>
                          : approval.status==='rejected'
                            ? <CircleX size={18}/>
                            : <Clock3 size={18}/>
                        }

                        <strong>
                          {approval.approver?.full_name ||
                            approval.approver?.email ||
                            'Approver'}
                        </strong>
                      </span>

                      <span className="workApprovalStatus">
                        Round {approval.approval_round}
                        {' · '}
                        {approval.status}
                      </span>
                    </div>

                    {approval.request_note&&
                      <p>{approval.request_note}</p>
                    }

                    {approval.decision_note&&
                      <p className="workApprovalDecision">
                        Decision note: {approval.decision_note}
                      </p>
                    }

                    <small>
                      Requested by {
                        approval.requester?.full_name ||
                        approval.requester?.email ||
                        'employee'
                      } on {
                        new Date(
                          approval.requested_at
                        ).toLocaleString()
                      }
                    </small>

                    {(canDecide||canCancel)&&
                      <div className="workApprovalActions">
                        <textarea
                          value={decisionNotes[approval.id] || ''}
                          onChange={event=>
                            setDecisionNotes(current=>({
                              ...current,
                              [approval.id]:event.target.value
                            }))
                          }
                          placeholder="Optional decision note"
                        />

                        <div className="buttonRow">
                          {canDecide&&
                            <>
                              <button
                                type="button"
                                className="glassButton approvalReject"
                                disabled={busy}
                                onClick={()=>
                                  void decideApproval(
                                    approval.id,
                                    'rejected'
                                  )
                                }
                              >
                                <CircleX size={15}/>
                                Reject
                              </button>

                              <button
                                type="button"
                                className="primaryButton"
                                disabled={busy}
                                onClick={()=>
                                  void decideApproval(
                                    approval.id,
                                    'approved'
                                  )
                                }
                              >
                                <Check size={15}/>
                                Approve
                              </button>
                            </>
                          }

                          {canCancel&&
                            <button
                              type="button"
                              className="glassButton"
                              disabled={busy}
                              onClick={()=>
                                void cancelApproval(
                                  approval.id
                                )
                              }
                            >
                              Cancel request
                            </button>
                          }
                        </div>
                      </div>
                    }
                  </article>
                )
              })}

              {!loading&&!approvals.length&&
                <small>No approval requested.</small>
              }
            </div>

            {canRequestApproval&&
              <div className="workApprovalRequest">
                <select
                  value={selectedApprover}
                  onChange={event=>
                    setSelectedApprover(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    Select approver...
                  </option>

                  {approvalCandidates.map(person=>
                    <option
                      key={person.id}
                      value={person.id}
                    >
                      {person.full_name}
                      {' — '}
                      {person.department}
                    </option>
                  )}
                </select>

                <textarea
                  value={approvalNote}
                  onChange={event=>
                    setApprovalNote(
                      event.target.value
                    )
                  }
                  placeholder="What should the approver verify?"
                />

                <button
                  type="button"
                  className="primaryButton"
                  disabled={busy||!selectedApprover}
                  onClick={()=>
                    void requestApproval()
                  }
                >
                  <ShieldCheck size={16}/>
                  Request approval
                </button>
              </div>
            }
          </section>


          <section className="workDetailSection">
            <h3>
              <MessageSquare size={17}/>
              Discussion
            </h3>

            <div className="workCommentList">
              {comments.map(entry=>
                <article key={entry.id}>
                  <div>
                    <strong>
                      {entry.author?.full_name ||
                        entry.author?.email ||
                        'Employee'}
                    </strong>

                    <small>
                      {new Date(
                        entry.created_at
                      ).toLocaleString()}
                    </small>
                  </div>

                  <p>
                    {entry.body}
                  </p>
                </article>
              )}

              {!loading&&!comments.length&&
                <small>
                  No comments yet.
                </small>
              }
            </div>

            <div className="workCommentComposer">
              <textarea
                value={comment}
                onChange={event=>
                  setComment(
                    event.target.value
                  )
                }
                placeholder="Write a comment..."
              />

              <button
                type="button"
                className="primaryButton"
                disabled={
                  busy ||
                  !comment.trim()
                }
                onClick={()=>
                  void addComment()
                }
              >
                <Send size={16}/>
                Send
              </button>
            </div>
          </section>


          <section className="workDetailSection dangerSection">
            <h3>
              <AlertTriangle size={17}/>
              Escalation
            </h3>

            {item.escalation_reason&&
              <p>
                Current reason:
                {' '}
                {item.escalation_reason}
              </p>
            }

            <textarea
              value={escalationReason}
              onChange={event=>
                setEscalationReason(
                  event.target.value
                )
              }
              placeholder="Why is this work being escalated?"
            />

            <button
              type="button"
              className="glassButton"
              disabled={busy}
              onClick={()=>
                void escalate()
              }
            >
              <AlertTriangle size={16}/>
              Escalate work
            </button>
          </section>


          <section className="workDetailSection">
            <h3>
              Activity
            </h3>

            <div className="workActivity">
              {activity.map(event=>
                <div key={event.id}>
                  <span className="activityDot"/>

                  <span>
                    <strong>
                      {event.action.replace(
                        /_/g,
                        ' '
                      )}
                    </strong>

                    <small>
                      {event.actor?.full_name ||
                        'System'}
                      {' · '}
                      {new Date(
                        event.created_at
                      ).toLocaleString()}
                    </small>
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}

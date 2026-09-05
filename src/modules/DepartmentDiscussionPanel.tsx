import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  MessageSquareText,
  RefreshCw,
  Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../workflow-unification.css'

type Profile={
  id:string
  full_name:string
  department:string|null
}

type DiscussionMessage={
  id:string
  space_id:string
  author_id:string
  body:string
  created_at:string
}

export default function DepartmentDiscussionPanel(){
  const [profile,setProfile]=
    useState<Profile|null>(null)

  const [people,setPeople]=
    useState<Profile[]>([])

  const [spaceId,setSpaceId]=
    useState('')

  const [messages,setMessages]=
    useState<DiscussionMessage[]>([])

  const [draft,setDraft]=useState('')
  const [loading,setLoading]=useState(true)
  const [sending,setSending]=useState(false)
  const [notice,setNotice]=useState('')

  const peopleMap=useMemo(
    ()=>new Map(
      people.map(person=>[
        person.id,
        person
      ])
    ),
    [people]
  )

  const loadMessages=useCallback(
    async(targetSpaceId:string)=>{
      const client=supabase

      if(!client || !targetSpaceId){
        setMessages([])
        return
      }

      const result=await client
        .from('collaboration_messages')
        .select(
          'id,space_id,author_id,body,created_at'
        )
        .eq(
          'space_id',
          targetSpaceId
        )
        .order(
          'created_at',
          {ascending:true}
        )
        .limit(500)

      if(result.error){
        throw result.error
      }

      setMessages(
        (result.data || []) as DiscussionMessage[]
      )
    },
    []
  )

  const load=useCallback(async()=>{
    const client=supabase

    if(!client){
      setLoading(false)
      return
    }

    setLoading(true)
    setNotice('')

    try{
      const {
        data:{user},
        error:userError,
      }=await client.auth.getUser()

      if(userError){
        throw userError
      }

      if(!user){
        throw new Error(
          'Your workspace session has expired.'
        )
      }

      const [
        profileResult,
        peopleResult,
      ]=await Promise.all([
        client
          .from('employee_profiles')
          .select('id,full_name,department')
          .eq('id',user.id)
          .eq('active',true)
          .maybeSingle(),
        client
          .from('employee_profiles')
          .select('id,full_name,department')
          .eq('active',true)
          .order('full_name'),
      ])

      if(profileResult.error){
        throw profileResult.error
      }

      if(peopleResult.error){
        throw peopleResult.error
      }

      if(!profileResult.data){
        throw new Error(
          'Active employee profile required.'
        )
      }

      const current=
        profileResult.data as Profile

      setProfile(current)

      setPeople(
        (peopleResult.data || []) as Profile[]
      )

      const ensured=await client.rpc(
        'ensure_department_space'
      )

      if(ensured.error){
        throw ensured.error
      }

      const targetSpaceId=
        typeof ensured.data==='string'
          ? ensured.data
          : String(ensured.data || '')

      if(!targetSpaceId){
        throw new Error(
          'Department discussion workspace is unavailable.'
        )
      }

      setSpaceId(targetSpaceId)
      await loadMessages(targetSpaceId)
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load department discussion.'
      )
    }finally{
      setLoading(false)
    }
  },[
    loadMessages,
  ])

  useEffect(()=>{
    void load()
  },[
    load,
  ])

  useEffect(()=>{
    const client=supabase

    if(!client || !spaceId){
      return
    }

    const channel=client
      .channel(
        `department-discussion-${spaceId}`
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'collaboration_messages',
          filter:`space_id=eq.${spaceId}`,
        },
        ()=>{
          void loadMessages(spaceId)
        }
      )
      .subscribe()

    return ()=>{
      void client.removeChannel(channel)
    }
  },[
    spaceId,
    loadMessages,
  ])

  const send=async()=>{
    const client=supabase

    if(
      !client
      || !profile
      || !spaceId
      || !draft.trim()
    ){
      return
    }

    setSending(true)
    setNotice('')

    try{
      const result=await client
        .from('collaboration_messages')
        .insert({
          space_id:spaceId,
          author_id:profile.id,
          body:draft.trim(),
        })

      if(result.error){
        throw result.error
      }

      setDraft('')
      await loadMessages(spaceId)
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to send discussion message.'
      )
    }finally{
      setSending(false)
    }
  }

  return (
    <section className="departmentDiscussion glassCard">
      <header className="departmentDiscussionHeader">
        <div>
          <span className="eyebrow">
            PRIVATE DEPARTMENT DISCUSSION
          </span>
          <h3>
            {profile?.department
              ? `${profile.department} Discussion`
              : 'Department Discussion'
            }
          </h3>
          <p>
            Messages are available only to active members
            of this department. Company-wide Manager/Admin
            status does not create a discussion-content bypass.
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          disabled={loading}
          onClick={()=>{
            void load()
          }}
        >
          <RefreshCw size={15}/>
          Refresh
        </button>
      </header>

      {notice&&
        <div className="moduleNotice">
          {notice}
        </div>
      }

      <div className="departmentDiscussionMessages">
        {messages.map(message=>{
          const author=
            peopleMap.get(message.author_id)

          return (
            <article
              key={message.id}
              className={
                message.author_id===profile?.id
                  ? 'departmentDiscussionMessage mine'
                  : 'departmentDiscussionMessage'
              }
            >
              <div>
                <strong>
                  {author?.full_name
                    || 'RideArrivo employee'
                  }
                </strong>
                <small>
                  {new Date(
                    message.created_at
                  ).toLocaleString()}
                </small>
              </div>

              <p>
                {message.body}
              </p>
            </article>
          )
        })}

        {!loading&&!messages.length&&
          <div className="workflowEmpty">
            <MessageSquareText size={28}/>
            <strong>
              No department messages yet.
            </strong>
          </div>
        }
      </div>

      <div className="departmentDiscussionComposer">
        <textarea
          value={draft}
          maxLength={10000}
          placeholder="Message your department..."
          onChange={event=>{
            setDraft(event.target.value)
          }}
        />

        <button
          type="button"
          className="primaryButton"
          disabled={
            sending
            || !spaceId
            || !draft.trim()
          }
          onClick={()=>{
            void send()
          }}
        >
          <Send size={16}/>
          {sending
            ? 'Sending...'
            : 'Send'
          }
        </button>
      </div>
    </section>
  )
}

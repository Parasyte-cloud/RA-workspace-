import {
  useEffect,
  useState
} from 'react'

import {supabase} from '../lib/supabase'

type Content={
  id:string
  title:string
  campaign_id:string|null
  status:string
}

type CampaignCreator={
  id:string
  campaign_id:string
  creator_id:string
  relationship_type:string
  tracking_code:string
  status:string
}

type Creator={
  id:string
  display_name:string
  creator_code:string
  status:string
}

type RelationshipRole=
  | 'primary'
  | 'collaborator'
  | 'featured'
  | 'paid_partner'

type Draft={
  content_id:string
  campaign_creator_id:string
  relationship_role:RelationshipRole
  platform_content_id:string
  post_url:string
}

const relationshipRoles:
  readonly RelationshipRole[]=[
    'primary',
    'collaborator',
    'featured',
    'paid_partner'
  ]

export default function MarketingContentCreatorManager({
  role
}:{
  role:string|null
}){
  const canManage=
    role==='marketing' ||
    role==='admin'

  const [content,setContent]=
    useState<Content[]>([])

  const [assignments,setAssignments]=
    useState<CampaignCreator[]>([])

  const [creators,setCreators]=
    useState<Creator[]>([])

  const [draft,setDraft]=
    useState<Draft>({
      content_id:'',
      campaign_creator_id:'',
      relationship_role:'primary',
      platform_content_id:'',
      post_url:''
    })

  const [loading,setLoading]=
    useState(false)

  const [saving,setSaving]=
    useState(false)

  const [notice,setNotice]=
    useState('')

  useEffect(()=>{
    if(canManage===false){
      return
    }

    const load=async()=>{
      const client=supabase

      if(client===null){
        setNotice(
          'Content creator management is unavailable.'
        )
        return
      }

      setLoading(true)
      setNotice('')

      const [
        contentResult,
        assignmentResult,
        creatorResult
      ]=await Promise.all([
        client
          .from('marketing_content')
          .select(
            'id,title,campaign_id,status'
          )
          .order('title'),
        client
          .from('marketing_campaign_creators')
          .select(
            'id,campaign_id,creator_id,relationship_type,tracking_code,status'
          ),
        client
          .from('marketing_creators')
          .select(
            'id,display_name,creator_code,status'
          )
          .order('display_name')
      ])

      setLoading(false)

      if(
        contentResult.error ||
        assignmentResult.error ||
        creatorResult.error
      ){
        setNotice(
          contentResult.error?.message ||
          assignmentResult.error?.message ||
          creatorResult.error?.message ||
          'Unable to load content creator data.'
        )
        return
      }

      const contentRows=
        (contentResult.data || []) as Content[]

      setContent(
        contentRows.filter(
          item=>
            item.campaign_id===null
              ? false
              : true
        )
      )

      setAssignments(
        (assignmentResult.data || []) as CampaignCreator[]
      )

      setCreators(
        (creatorResult.data || []) as Creator[]
      )
    }

    void load()
  },[canManage])

  if(canManage===false){
    return null
  }

  const selectedContent=
    content.find(
      item=>item.id===draft.content_id
    ) ?? null

  const eligibleAssignments=
    selectedContent===null
      ? []
      : assignments.filter(
          item=>
            item.campaign_id===
            selectedContent.campaign_id
        )

  const selectedAssignment=
    eligibleAssignments.find(
      item=>
        item.id===draft.campaign_creator_id
    ) ?? null

  const selectedCreator=
    selectedAssignment===null
      ? null
      : creators.find(
          item=>
            item.id===selectedAssignment.creator_id
        ) ?? null

  const normalizedPlatformContentId=
    draft.platform_content_id.trim()

  const normalizedPostUrl=
    draft.post_url.trim()

  const validationError=(()=>{
    if(
      selectedContent===null ||
      selectedContent.campaign_id===null
    ){
      return 'Select campaign-bound content.'
    }

    if(selectedAssignment===null){
      return 'Select a creator assignment from the same campaign.'
    }

    if(
      selectedAssignment.campaign_id!==
      selectedContent.campaign_id
    ){
      return 'Creator assignment must belong to the content campaign.'
    }

    if(
      relationshipRoles.includes(
        draft.relationship_role
      )===false
    ){
      return 'Select a valid relationship role.'
    }

    if(
      normalizedPlatformContentId.length>255
    ){
      return 'Platform content ID must be 255 characters or fewer.'
    }

    if(
      normalizedPostUrl.length>0 &&
      /^https:\/\//i.test(
        normalizedPostUrl
      )===false
    ){
      return 'Post URL must use HTTPS.'
    }

    return ''
  })()

  const createLink=async()=>{
    setNotice('')

    if(validationError.length>0){
      setNotice(validationError)
      return
    }

    if(
      selectedContent===null ||
      selectedContent.campaign_id===null ||
      selectedAssignment===null
    ){
      setNotice(
        'Select valid campaign-bound content and creator assignment.'
      )
      return
    }

    const client=supabase

    if(client===null){
      setNotice(
        'Content creator management is unavailable.'
      )
      return
    }

    setSaving(true)

    const {error}=await client
      .from('marketing_content_creators')
      .insert({
        campaign_id:selectedContent.campaign_id,
        content_id:selectedContent.id,
        campaign_creator_id:selectedAssignment.id,
        relationship_role:draft.relationship_role,
        platform_content_id:
          normalizedPlatformContentId.length===0
            ? null
            : normalizedPlatformContentId,
        post_url:
          normalizedPostUrl.length===0
            ? null
            : normalizedPostUrl
      })

    setSaving(false)

    if(error){
      setNotice(error.message)
      return
    }

    setDraft({
      content_id:'',
      campaign_creator_id:'',
      relationship_role:'primary',
      platform_content_id:'',
      post_url:''
    })

    setNotice(
      'Creator linked to campaign content.'
    )
  }

  return (
    <section className="glassCard marketingIntelManager">
      <header>
        <div>
          <span className="eyebrow">
            CONTENT CREATOR MANAGEMENT
          </span>
          <h3>Link creator to campaign content</h3>
        </div>
      </header>

      <p>
        {loading
          ? 'Loading campaign-bound content...'
          : `${content.length} bound content items · ${assignments.length} creator assignments · ${creators.length} creators`}
      </p>

      <form
        onSubmit={event=>{
          event.preventDefault()
          void createLink()
        }}
      >
        <label>
          Campaign content
          <select
            required
            value={draft.content_id}
            onChange={event=>
              setDraft(current=>({
                ...current,
                content_id:event.target.value,
                campaign_creator_id:''
              }))
            }
          >
            <option value="">
              Select campaign-bound content
            </option>

            {content.map(item=>
              <option
                key={item.id}
                value={item.id}
              >
                {item.title} · {item.status}
              </option>
            )}
          </select>
        </label>

        <label>
          Creator assignment
          <select
            required
            disabled={selectedContent===null}
            value={draft.campaign_creator_id}
            onChange={event=>
              setDraft(current=>({
                ...current,
                campaign_creator_id:
                  event.target.value
              }))
            }
          >
            <option value="">
              Select same-campaign creator
            </option>

            {eligibleAssignments.map(assignment=>{
              const creator=
                creators.find(
                  item=>
                    item.id===assignment.creator_id
                )

              return (
                <option
                  key={assignment.id}
                  value={assignment.id}
                >
                  {creator?.display_name ?? 'Unknown creator'}
                  {' · '}
                  {creator?.creator_code ?? assignment.creator_id}
                  {' · '}
                  {assignment.relationship_type}
                  {' · '}
                  {assignment.tracking_code}
                  {' · '}
                  {assignment.status}
                </option>
              )
            })}
          </select>
        </label>

        <label>
          Relationship role
          <select
            required
            value={draft.relationship_role}
            onChange={event=>
              setDraft(current=>({
                ...current,
                relationship_role:
                  event.target.value as RelationshipRole
              }))
            }
          >
            {relationshipRoles.map(roleOption=>
              <option
                key={roleOption}
                value={roleOption}
              >
                {roleOption}
              </option>
            )}
          </select>
        </label>

        <label>
          Platform content ID
          <input
            type="text"
            maxLength={255}
            value={draft.platform_content_id}
            onChange={event=>
              setDraft(current=>({
                ...current,
                platform_content_id:
                  event.target.value
              }))
            }
            placeholder="Optional platform post/content ID"
          />
        </label>

        <label>
          Public post URL
          <input
            type="url"
            value={draft.post_url}
            onChange={event=>
              setDraft(current=>({
                ...current,
                post_url:event.target.value
              }))
            }
            placeholder="https://..."
          />
        </label>

        <p className="muted">
          Creator assignments are limited to the same
          campaign as the selected content. The database
          composite foreign keys remain the final
          campaign-integrity authority.
        </p>

        {selectedCreator &&
          <p className="muted">
            Selected creator:
            {' '}
            {selectedCreator.display_name}
            {' · '}
            {selectedCreator.creator_code}
            {' · '}
            {selectedCreator.status}
          </p>
        }

        <button
          type="submit"
          disabled={saving || loading}
        >
          {saving
            ? 'Linking...'
            : 'Link creator to content'}
        </button>

        {notice &&
          <p role="status">
            {notice}
          </p>
        }
      </form>
    </section>
  )
}

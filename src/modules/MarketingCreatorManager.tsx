import {
  type FormEvent,
  useState
} from 'react'

import {supabase} from '../lib/supabase'

type CreatorType=
  | 'influencer'
  | 'creator'
  | 'affiliate'
  | 'ambassador'
  | 'media_partner'

type Draft={
  display_name:string
  creator_code:string
  creator_type:CreatorType
  sourced_via:string
  primary_platform:string
  public_handle:string
  profile_url:string
}

const blankDraft=():Draft=>({
  display_name:'',
  creator_code:'',
  creator_type:'influencer',
  sourced_via:'',
  primary_platform:'',
  public_handle:'',
  profile_url:''
})

const optional=(value:string)=>{
  const trimmed=value.trim()
  return trimmed || null
}

export default function MarketingCreatorManager({
  role
}:{
  role:string|null
}){
  const canManage=
    role==='marketing' ||
    role==='admin'

  const [draft,setDraft]=useState<Draft>(
    blankDraft()
  )
  const [saving,setSaving]=useState(false)
  const [notice,setNotice]=useState('')

  if(!canManage){
    return null
  }

  const submit=async(
    event:FormEvent<HTMLFormElement>
  )=>{
    event.preventDefault()
    setNotice('')

    const client=supabase

    if(!client){
      setNotice(
        'Creator registration is unavailable.'
      )
      return
    }

    const displayName=
      draft.display_name.trim()

    const creatorCode=
      draft.creator_code
        .trim()
        .toLowerCase()

    if(
      displayName.length<2 ||
      displayName.length>160
    ){
      setNotice(
        'Display name must be 2 to 160 characters.'
      )
      return
    }

    if(
      !/^[a-z0-9][a-z0-9_-]{1,63}$/
        .test(creatorCode)
    ){
      setNotice(
        'Creator code must use lowercase letters, numbers, hyphens or underscores.'
      )
      return
    }

    const profileUrl=
      optional(draft.profile_url)

    if(profileUrl){
      try{
        const parsed=new URL(profileUrl)

        if(parsed.protocol!=='https:'){
          throw new Error('HTTPS required')
        }
      }catch{
        setNotice(
          'Profile URL must be a valid HTTPS URL.'
        )
        return
      }
    }

    setSaving(true)

    const {error}=await client
      .from('marketing_creators')
      .insert({
        display_name:displayName,
        creator_code:creatorCode,
        creator_type:draft.creator_type,
        sourced_via:optional(
          draft.sourced_via
        ),
        primary_platform:optional(
          draft.primary_platform
        ),
        public_handle:optional(
          draft.public_handle
        ),
        profile_url:profileUrl
      })

    setSaving(false)

    if(error){
      setNotice(error.message)
      return
    }

    setDraft(blankDraft())

    setNotice(
      'Creator registered. Refresh intelligence to update totals.'
    )
  }

  return (
    <section className="glassCard marketingIntelManager">
      <header>
        <div>
          <span className="eyebrow">
            CREATOR MANAGEMENT
          </span>
          <h3>Register creator</h3>
        </div>
      </header>

      <form onSubmit={submit}>
        <label>
          Display name
          <input
            required
            maxLength={160}
            value={draft.display_name}
            onChange={event=>setDraft({
              ...draft,
              display_name:event.target.value
            })}
          />
        </label>

        <label>
          Creator code
          <input
            required
            maxLength={64}
            value={draft.creator_code}
            onChange={event=>setDraft({
              ...draft,
              creator_code:event.target.value
            })}
          />
        </label>

        <label>
          Creator type
          <select
            value={draft.creator_type}
            onChange={event=>setDraft({
              ...draft,
              creator_type:
                event.target.value as CreatorType
            })}
          >
            <option value="influencer">Influencer</option>
            <option value="creator">Creator</option>
            <option value="affiliate">Affiliate</option>
            <option value="ambassador">Ambassador</option>
            <option value="media_partner">Media partner</option>
          </select>
        </label>

        <label>
          Primary platform
          <input
            maxLength={64}
            value={draft.primary_platform}
            onChange={event=>setDraft({
              ...draft,
              primary_platform:event.target.value
            })}
          />
        </label>

        <label>
          Public handle
          <input
            maxLength={160}
            value={draft.public_handle}
            onChange={event=>setDraft({
              ...draft,
              public_handle:event.target.value
            })}
          />
        </label>

        <label>
          Sourced via
          <input
            maxLength={160}
            value={draft.sourced_via}
            onChange={event=>setDraft({
              ...draft,
              sourced_via:event.target.value
            })}
          />
        </label>

        <label>
          Public profile URL
          <input
            type="url"
            value={draft.profile_url}
            onChange={event=>setDraft({
              ...draft,
              profile_url:event.target.value
            })}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
        >
          {saving
            ? 'Registering...'
            : 'Register creator'}
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

import {
  type FormEvent,
  useEffect,
  useState
} from 'react'

import {supabase} from '../lib/supabase'

type Campaign={
  id:string
  name:string
  status:string
}

type Content={
  id:string
  title:string
  status:string
  campaign_id:string|null
}

export default function MarketingContentCampaignManager({
  role
}:{
  role:string|null
}){
  const canManage=
    role==='marketing' ||
    role==='admin'

  const [campaigns,setCampaigns]=
    useState<Campaign[]>([])

  const [content,setContent]=
    useState<Content[]>([])

  const [selectedContentId,setSelectedContentId]=
    useState('')

  const [selectedCampaignId,setSelectedCampaignId]=
    useState('')

  const [saving,setSaving]=
    useState(false)

  const [loading,setLoading]=
    useState(false)

  const [notice,setNotice]=
    useState('')

  useEffect(()=>{
    if(!canManage){
      return
    }

    const load=async()=>{
      const client=supabase

      if(!client){
        setNotice(
          'Content campaign binding is unavailable.'
        )
        return
      }

      setLoading(true)
      setNotice('')

      const [campaignResult,contentResult]=
        await Promise.all([
          client
            .from('marketing_campaigns')
            .select('id,name,status')
            .order('name'),
          client
            .from('marketing_content')
            .select(
              'id,title,status,campaign_id'
            )
            .is('campaign_id',null)
            .order('title')
        ])

      setLoading(false)

      if(
        campaignResult.error ||
        contentResult.error
      ){
        setNotice(
          campaignResult.error?.message ||
          contentResult.error?.message ||
          'Unable to load campaign binding data.'
        )
        return
      }

      setCampaigns(
        (campaignResult.data || []) as Campaign[]
      )

      setContent(
        (contentResult.data || []) as Content[]
      )
    }

    void load()
  },[canManage])

  if(!canManage){
    return null
  }

  const submit=async(
    event:FormEvent<HTMLFormElement>
  )=>{
    event.preventDefault()
    setNotice('')

    const contentExists=
      content.some(
        item=>item.id===selectedContentId
      )

    const campaignExists=
      campaigns.some(
        item=>item.id===selectedCampaignId
      )

    if(
      contentExists===false ||
      campaignExists===false
    ){
      setNotice(
        'Select valid unbound content and a campaign.'
      )
      return
    }

    const client=supabase

    if(client===null){
      setNotice(
        'Content campaign binding is unavailable.'
      )
      return
    }

    setSaving(true)

    const {data,error}=await client
      .from('marketing_content')
      .update({
        campaign_id:selectedCampaignId
      })
      .eq('id',selectedContentId)
      .is('campaign_id',null)
      .select('id,campaign_id')
      .maybeSingle()

    setSaving(false)

    if(error){
      setNotice(error.message)
      return
    }

    if(
      data===null ||
      data===undefined
    ){
      setContent(items=>
        items.filter(
          item=>item.id!==selectedContentId
        )
      )

      setSelectedContentId('')

      setNotice(
        'Content is no longer unbound. Refresh before trying again.'
      )
      return
    }

    setContent(items=>
      items.filter(
        item=>item.id!==selectedContentId
      )
    )

    setSelectedContentId('')
    setSelectedCampaignId('')

    setNotice(
      'Content assigned to campaign.'
    )
  }

  return (
    <section className="glassCard marketingIntelManager">
      <header>
        <div>
          <span className="eyebrow">
            CONTENT CAMPAIGN MANAGEMENT
          </span>
          <h3>Assign content to campaign</h3>
        </div>
      </header>

      <p>
        {loading
          ? 'Loading unbound content...'
          : `${content.length} unbound content items · ${campaigns.length} campaigns`}
      </p>

      <form onSubmit={submit}>
        <label>
          Content
          <select
            required
            value={selectedContentId}
            onChange={event=>
              setSelectedContentId(
                event.target.value
              )
            }
          >
            <option value="">
              Select unbound content
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
          Campaign
          <select
            required
            value={selectedCampaignId}
            onChange={event=>
              setSelectedCampaignId(
                event.target.value
              )
            }
          >
            <option value="">
              Select campaign
            </option>

            {campaigns.map(campaign=>
              <option
                key={campaign.id}
                value={campaign.id}
              >
                {campaign.name} · {campaign.status}
              </option>
            )}
          </select>
        </label>

        <p className="muted">
          Only content without an existing campaign assignment
          is eligible. This workflow does not reassign
          content that is already bound to a campaign.
        </p>

        <button
          type="submit"
          disabled={saving || loading}
        >
          {saving
            ? 'Assigning...'
            : 'Assign content'}
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

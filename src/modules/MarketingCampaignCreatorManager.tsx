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

type Creator={
  id:string
  display_name:string
  creator_code:string
  status:string
}

export type Relationship=
  | 'paid'
  | 'affiliate'
  | 'ambassador'
  | 'barter'
  | 'earned'
  | 'other'

export type AssignmentStatus=
  | 'planned'
  | 'contracted'
  | 'active'
  | 'completed'
  | 'cancelled'

export type CampaignCreatorDraft={
  campaign_id:string
  creator_id:string
  relationship_type:Relationship
  agreed_fee:string
  currency:string
  tracking_code:string
  status:AssignmentStatus
  started_at:string
  ended_at:string
  brief:string
}

export const blankCampaignCreatorDraft=
  ():CampaignCreatorDraft=>({
    campaign_id:'',
    creator_id:'',
    relationship_type:'paid',
    agreed_fee:'0',
    currency:'NGN',
    tracking_code:'',
    status:'planned',
    started_at:'',
    ended_at:'',
    brief:''
  })

export const validateCampaignCreatorDraft=(
  draft:CampaignCreatorDraft
)=>{
  if(
    !draft.campaign_id ||
    !draft.creator_id
  ){
    return 'Select both a campaign and creator.'
  }

  const trackingCode=
    draft.tracking_code
      .trim()
      .toLowerCase()

  if(
    !/^[a-z0-9][a-z0-9_-]{1,95}$/
      .test(trackingCode)
  ){
    return 'Tracking code is invalid.'
  }

  const currency=
    draft.currency
      .trim()
      .toUpperCase()

  if(!/^[A-Z]{3}$/.test(currency)){
    return 'Currency must be a three-letter code.'
  }

  const agreedFee=
    Number(draft.agreed_fee)

  if(
    !Number.isFinite(agreedFee) ||
    agreedFee<0
  ){
    return 'Agreed fee must be zero or greater.'
  }

  if(
    draft.started_at &&
    draft.ended_at &&
    draft.ended_at<draft.started_at
  ){
    return 'End date cannot be before start date.'
  }

  if(draft.brief.length>8000){
    return 'Brief cannot exceed 8,000 characters.'
  }

  return null
}

export default function MarketingCampaignCreatorManager({
  role
}:{
  role:string|null
}){
  const canManage=
    role==='marketing' ||
    role==='admin'

  const [campaigns,setCampaigns]=
    useState<Campaign[]>([])

  const [creators,setCreators]=
    useState<Creator[]>([])

  const [draft,setDraft]=
    useState<CampaignCreatorDraft>(
      blankCampaignCreatorDraft()
    )

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
          'Campaign assignment is unavailable.'
        )
        return
      }

      setLoading(true)
      setNotice('')

      const [campaignResult,creatorResult]=
        await Promise.all([
          client
            .from('marketing_campaigns')
            .select('id,name,status')
            .order('name'),
          client
            .from('marketing_creators')
            .select(
              'id,display_name,creator_code,status'
            )
            .order('display_name')
        ])

      setLoading(false)

      if(
        campaignResult.error ||
        creatorResult.error
      ){
        setNotice(
          campaignResult.error?.message ||
          creatorResult.error?.message ||
          'Unable to load assignment data.'
        )
        return
      }

      setCampaigns(
        (campaignResult.data || []) as Campaign[]
      )

      setCreators(
        (creatorResult.data || []) as Creator[]
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

    const validation=
      validateCampaignCreatorDraft(draft)

    if(validation){
      setNotice(validation)
      return
    }

    const client=supabase

    if(!client){
      setNotice(
        'Campaign assignment is unavailable.'
      )
      return
    }

    const trackingCode=
      draft.tracking_code
        .trim()
        .toLowerCase()

    const currency=
      draft.currency
        .trim()
        .toUpperCase()

    const agreedFee=
      Number(draft.agreed_fee)

    setSaving(true)

    const {error}=await client
      .from('marketing_campaign_creators')
      .insert({
        campaign_id:draft.campaign_id,
        creator_id:draft.creator_id,
        relationship_type:
          draft.relationship_type,
        agreed_fee:agreedFee,
        currency,
        tracking_code:trackingCode,
        status:draft.status,
        started_at:
          draft.started_at || null,
        ended_at:
          draft.ended_at || null,
        brief:
          draft.brief.trim() || null
      })

    setSaving(false)

    if(error){
      setNotice(error.message)
      return
    }

    setDraft(
      blankCampaignCreatorDraft()
    )

    setNotice(
      'Creator assigned. Agreed fee is contractual only; actual payments remain authoritative in Marketing Wallet.'
    )
  }

  return (
    <section className="glassCard marketingIntelManager">
      <header>
        <div>
          <span className="eyebrow">
            CAMPAIGN CREATOR MANAGEMENT
          </span>
          <h3>Assign creator to campaign</h3>
        </div>
      </header>

      {loading &&
        <p>Loading campaigns and creators...</p>
      }

      <form onSubmit={submit}>
        <label>
          Campaign
          <select
            required
            value={draft.campaign_id}
            onChange={event=>setDraft({
              ...draft,
              campaign_id:event.target.value
            })}
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

        <label>
          Creator
          <select
            required
            value={draft.creator_id}
            onChange={event=>setDraft({
              ...draft,
              creator_id:event.target.value
            })}
          >
            <option value="">
              Select creator
            </option>

            {creators.map(creator=>
              <option
                key={creator.id}
                value={creator.id}
              >
                {creator.display_name}
                {' · '}
                {creator.creator_code}
              </option>
            )}
          </select>
        </label>

        <label>
          Relationship
          <select
            value={draft.relationship_type}
            onChange={event=>setDraft({
              ...draft,
              relationship_type:
                event.target.value as Relationship
            })}
          >
            <option value="paid">Paid</option>
            <option value="affiliate">Affiliate</option>
            <option value="ambassador">Ambassador</option>
            <option value="barter">Barter</option>
            <option value="earned">Earned</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          Tracking code
          <input
            required
            maxLength={96}
            value={draft.tracking_code}
            onChange={event=>setDraft({
              ...draft,
              tracking_code:event.target.value
            })}
          />
        </label>

        <label>
          Contractual agreed fee
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.agreed_fee}
            onChange={event=>setDraft({
              ...draft,
              agreed_fee:event.target.value
            })}
          />
        </label>

        <label>
          Currency
          <input
            required
            maxLength={3}
            value={draft.currency}
            onChange={event=>setDraft({
              ...draft,
              currency:event.target.value
            })}
          />
        </label>

        <label>
          Assignment status
          <select
            value={draft.status}
            onChange={event=>setDraft({
              ...draft,
              status:
                event.target.value as AssignmentStatus
            })}
          >
            <option value="planned">Planned</option>
            <option value="contracted">Contracted</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        <label>
          Start date
          <input
            type="date"
            value={draft.started_at}
            onChange={event=>setDraft({
              ...draft,
              started_at:event.target.value
            })}
          />
        </label>

        <label>
          End date
          <input
            type="date"
            value={draft.ended_at}
            onChange={event=>setDraft({
              ...draft,
              ended_at:event.target.value
            })}
          />
        </label>

        <label>
          Campaign brief
          <textarea
            maxLength={8000}
            value={draft.brief}
            onChange={event=>setDraft({
              ...draft,
              brief:event.target.value
            })}
          />
        </label>

        <p className="muted">
          Agreed fee records the commercial agreement only.
          Actual creator payments and settlements remain
          authoritative in Marketing Wallet.
        </p>

        <button
          type="submit"
          disabled={saving || loading}
        >
          {saving
            ? 'Assigning...'
            : 'Assign creator'}
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

import {
  useEffect,
  useState
} from 'react'
import {Copy, Link2} from 'lucide-react'
import {supabase} from '../lib/supabase'

type Campaign={
  id:string
  name:string
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

type ContentCreator={
  id:string
  campaign_id:string
  campaign_creator_id:string
  content_id:string
  relationship_role:string
}

type Creator={
  id:string
  display_name:string
  creator_code:string
  status:string
}

type Content={
  id:string
  title:string
  campaign_id:string|null
  status:string
}

function slug(value:string){
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
}

function rideArrivoDestination(value:string){
  try{
    const url=new URL(value.trim())
    const hostname=url.hostname.toLowerCase()

    if(
      url.protocol!=='https:' ||
      (
        hostname!=='ridearrivo.com' &&
        !hostname.endsWith('.ridearrivo.com')
      ) ||
      url.search!=='' ||
      url.hash!==''
    ){
      return null
    }

    return url
  }catch{
    return null
  }
}

function buildTrackingUrl({
  destinationUrl,
  utmSource,
  utmMedium,
  utmCampaign,
  utmContent,
  utmTerm
}:{
  destinationUrl:string
  utmSource:string
  utmMedium:string
  utmCampaign:string
  utmContent:string
  utmTerm:string
}){
  const url=rideArrivoDestination(destinationUrl)

  if(
    url===null ||
    utmSource.trim()==='' ||
    utmMedium.trim()==='' ||
    utmCampaign.trim()===''
  ){
    return ''
  }

  url.searchParams.set(
    'utm_source',
    utmSource.trim()
  )
  url.searchParams.set(
    'utm_medium',
    utmMedium.trim()
  )
  url.searchParams.set(
    'utm_campaign',
    utmCampaign.trim()
  )

  if(utmContent.trim()!==''){
    url.searchParams.set(
      'utm_content',
      utmContent.trim()
    )
  }

  if(utmTerm.trim()!==''){
    url.searchParams.set(
      'utm_term',
      utmTerm.trim()
    )
  }

  return url.toString()
}

function makeTrackingCode(seed:string){
  const cleaned=
    slug(seed)
      .replace(/-/g,'_')
      .slice(0,72) || 'ridearrivo'

  return (
    `${cleaned}_${Date.now().toString(36)}`
      .slice(0,96)
  )
}

export default function MarketingTrackingLinkManager({
  role
}:{
  role:string|null
}){
  const canManage=
    role==='marketing' ||
    role==='admin'

  const [campaigns,setCampaigns]=
    useState<Campaign[]>([])
  const [campaignCreators,setCampaignCreators]=
    useState<CampaignCreator[]>([])
  const [contentCreators,setContentCreators]=
    useState<ContentCreator[]>([])
  const [creators,setCreators]=
    useState<Creator[]>([])
  const [content,setContent]=
    useState<Content[]>([])

  const [campaignId,setCampaignId]=
    useState('')
  const [campaignCreatorId,setCampaignCreatorId]=
    useState('')
  const [contentCreatorId,setContentCreatorId]=
    useState('')

  const [destinationUrl,setDestinationUrl]=
    useState('https://ridearrivo.com/')
  const [utmSource,setUtmSource]=
    useState('')
  const [utmMedium,setUtmMedium]=
    useState('')
  const [utmCampaign,setUtmCampaign]=
    useState('')
  const [utmContent,setUtmContent]=
    useState('')
  const [utmTerm,setUtmTerm]=
    useState('')
  const [trackingCode,setTrackingCode]=
    useState('')

  const [loading,setLoading]=
    useState(true)
  const [saving,setSaving]=
    useState(false)
  const [notice,setNotice]=
    useState('')

  useEffect(()=>{
    if(canManage===false){
      setLoading(false)
      return
    }

    const load=async()=>{
      const client=supabase

      if(client===null){
        setNotice(
          'Tracking link management is unavailable.'
        )
        setLoading(false)
        return
      }

      setLoading(true)
      setNotice('')

      const [
        campaignResult,
        campaignCreatorResult,
        contentCreatorResult,
        creatorResult,
        contentResult
      ]=await Promise.all([
        client
          .from('marketing_campaigns')
          .select(
            'id,name,status'
          )
          .order('name'),
        client
          .from('marketing_campaign_creators')
          .select(
            'id,campaign_id,creator_id,relationship_type,tracking_code,status'
          ),
        client
          .from('marketing_content_creators')
          .select(
            'id,campaign_id,campaign_creator_id,content_id,relationship_role'
          ),
        client
          .from('marketing_creators')
          .select(
            'id,display_name,creator_code,status'
          )
          .order('display_name'),
        client
          .from('marketing_content')
          .select(
            'id,title,campaign_id,status'
          )
          .order('title')
      ])

      setLoading(false)

      const failure=
        campaignResult.error ||
        campaignCreatorResult.error ||
        contentCreatorResult.error ||
        creatorResult.error ||
        contentResult.error

      if(failure){
        setNotice(
          failure.message ||
          'Unable to load tracking-link data.'
        )
        return
      }

      setCampaigns(
        (campaignResult.data || []) as Campaign[]
      )
      setCampaignCreators(
        (campaignCreatorResult.data || []) as CampaignCreator[]
      )
      setContentCreators(
        (contentCreatorResult.data || []) as ContentCreator[]
      )
      setCreators(
        (creatorResult.data || []) as Creator[]
      )
      setContent(
        (contentResult.data || []) as Content[]
      )
    }

    void load()
  },[canManage])

  const eligibleCampaignCreators=
    campaignCreators.filter(
      row=>row.campaign_id===campaignId
    )

  const eligibleContentCreators=
    contentCreators.filter(
      row=>
        row.campaign_id===campaignId &&
        row.campaign_creator_id===campaignCreatorId
    )

  const trackingUrlPreview=
    buildTrackingUrl({
      destinationUrl,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm
    })

  const creatorLabel=(creatorId:string)=>{
    const creator=
      creators.find(
        row=>row.id===creatorId
      )

    if(!creator){
      return 'Unknown creator'
    }

    return `${creator.display_name} · ${creator.creator_code}`
  }

  const contentLabel=(contentId:string)=>{
    const item=
      content.find(
        row=>row.id===contentId
      )

    return item?.title || 'Unknown content'
  }

  const chooseCampaign=(id:string)=>{
    setCampaignId(id)
    setCampaignCreatorId('')
    setContentCreatorId('')
    setUtmContent('')

    const campaign=
      campaigns.find(
        row=>row.id===id
      )

    if(campaign){
      setUtmCampaign(
        slug(campaign.name).slice(0,200)
      )
      setTrackingCode(
        makeTrackingCode(campaign.name)
      )
    }else{
      setUtmCampaign('')
      setTrackingCode('')
    }
  }

  const chooseCampaignCreator=(id:string)=>{
    setCampaignCreatorId(id)
    setContentCreatorId('')
    setUtmContent('')

    if(id===''){
      const campaign=
        campaigns.find(
          row=>row.id===campaignId
        )

      setTrackingCode(
        campaign
          ? makeTrackingCode(campaign.name)
          : ''
      )
      return
    }

    const assignment=
      eligibleCampaignCreators.find(
        row=>row.id===id
      )

    if(assignment){
      setTrackingCode(
        makeTrackingCode(
          assignment.tracking_code
        )
      )
    }
  }

  const chooseContentCreator=(id:string)=>{
    setContentCreatorId(id)

    if(id===''){
      setUtmContent('')
      return
    }

    const relationship=
      eligibleContentCreators.find(
        row=>row.id===id
      )

    if(!relationship){
      setUtmContent('')
      return
    }

    setUtmContent(
      slug(
        contentLabel(
          relationship.content_id
        )
      ).slice(0,200)
    )
  }

  const copyPreview=async()=>{
    if(trackingUrlPreview===''){
      setNotice(
        'Complete the required destination and UTM fields first.'
      )
      return
    }

    try{
      await navigator.clipboard.writeText(
        trackingUrlPreview
      )
      setNotice(
        'Tracking URL copied.'
      )
    }catch{
      setNotice(
        'Unable to copy the tracking URL.'
      )
    }
  }

  const createTrackingLink=async()=>{
    if(!canManage){
      return
    }

    const client=supabase

    if(client===null){
      setNotice(
        'Tracking link management is unavailable.'
      )
      return
    }

    if(
      campaignId==='' ||
      !campaigns.some(
        row=>row.id===campaignId
      )
    ){
      setNotice(
        'Select a valid campaign.'
      )
      return
    }

    if(
      campaignCreatorId!=='' &&
      !eligibleCampaignCreators.some(
        row=>row.id===campaignCreatorId
      )
    ){
      setNotice(
        'Select a creator assignment belonging to this campaign.'
      )
      return
    }

    if(
      contentCreatorId!=='' &&
      !eligibleContentCreators.some(
        row=>row.id===contentCreatorId
      )
    ){
      setNotice(
        'Select content linked to the chosen campaign creator.'
      )
      return
    }

    const destination=
      rideArrivoDestination(
        destinationUrl
      )

    if(destination===null){
      setNotice(
        'Destination must be an HTTPS RideArrivo URL with no existing query string or hash.'
      )
      return
    }

    const sourceValue=utmSource.trim()
    const mediumValue=utmMedium.trim()
    const campaignValue=utmCampaign.trim()
    const contentValue=utmContent.trim()
    const termValue=utmTerm.trim()
    const codeValue=
      trackingCode.trim().toLowerCase()

    if(
      sourceValue.length<1 ||
      sourceValue.length>160
    ){
      setNotice(
        'UTM source must contain 1 to 160 characters.'
      )
      return
    }

    if(
      mediumValue.length<1 ||
      mediumValue.length>160
    ){
      setNotice(
        'UTM medium must contain 1 to 160 characters.'
      )
      return
    }

    if(
      campaignValue.length<1 ||
      campaignValue.length>200
    ){
      setNotice(
        'UTM campaign must contain 1 to 200 characters.'
      )
      return
    }

    if(contentValue.length>200){
      setNotice(
        'UTM content cannot exceed 200 characters.'
      )
      return
    }

    if(termValue.length>200){
      setNotice(
        'UTM term cannot exceed 200 characters.'
      )
      return
    }

    if(
      !/^[a-z0-9][a-z0-9_-]{1,95}$/.test(
        codeValue
      )
    ){
      setNotice(
        'Tracking code must be 2 to 96 lowercase letters, numbers, underscores or hyphens and start with a letter or number.'
      )
      return
    }

    setSaving(true)
    setNotice('')

    const {error}=
      await client
        .from('marketing_tracking_links')
        .insert({
          campaign_id:campaignId,
          campaign_creator_id:
            campaignCreatorId || null,
          content_creator_id:
            contentCreatorId || null,
          destination_url:
            destination.toString(),
          utm_source:sourceValue,
          utm_medium:mediumValue,
          utm_campaign:campaignValue,
          utm_content:
            contentValue || null,
          'utm_term':
            termValue || null,
          tracking_code:codeValue,
          status:'active'
        })

    setSaving(false)

    if(error){
      setNotice(
        error.message ||
        'Unable to create tracking link.'
      )
      return
    }

    setNotice(
      'Tracking link created. Refresh Marketing Intelligence to update totals.'
    )

    setTrackingCode(
      makeTrackingCode(
        codeValue
      )
    )
  }

  if(canManage===false){
    return null
  }

  return (
    <section className="glassCard marketingIntelManager">
      <header>
        <div>
          <span className="eyebrow">
            TRACKING LINK MANAGEMENT
          </span>
          <h3>
            Create governed campaign tracking links
          </h3>
          <p>
            Persist approved RideArrivo campaign URLs while
            preserving campaign, creator and content attribution.
          </p>
        </div>
        <Link2 size={22}/>
      </header>

      <p className="muted">
        {loading
          ? 'Loading campaign tracking relationships...'
          : `${campaigns.length} campaigns · ${campaignCreators.length} creator assignments · ${contentCreators.length} content links`}
      </p>

      <div className="marketingFormGrid">
        <label>
          Campaign
          <select
            value={campaignId}
            disabled={loading || saving}
            onChange={event=>{
              chooseCampaign(
                event.target.value
              )
            }}
          >
            <option value="">
              Select campaign
            </option>
            {campaigns.map(row=>
              <option
                key={row.id}
                value={row.id}
              >
                {row.name} · {row.status}
              </option>
            )}
          </select>
        </label>

        <label>
          Creator assignment
          <select
            value={campaignCreatorId}
            disabled={
              loading ||
              saving ||
              campaignId===''
            }
            onChange={event=>{
              chooseCampaignCreator(
                event.target.value
              )
            }}
          >
            <option value="">
              Campaign only
            </option>
            {eligibleCampaignCreators.map(row=>
              <option
                key={row.id}
                value={row.id}
              >
                {creatorLabel(row.creator_id)}
                {' · '}
                {row.relationship_type}
                {' · '}
                {row.status}
              </option>
            )}
          </select>
        </label>

        <label>
          Creator-linked content
          <select
            value={contentCreatorId}
            disabled={
              loading ||
              saving ||
              campaignCreatorId===''
            }
            onChange={event=>{
              chooseContentCreator(
                event.target.value
              )
            }}
          >
            <option value="">
              No content attribution
            </option>
            {eligibleContentCreators.map(row=>
              <option
                key={row.id}
                value={row.id}
              >
                {contentLabel(row.content_id)}
                {' · '}
                {row.relationship_role}
              </option>
            )}
          </select>
        </label>

        <label>
          Destination URL
          <input
            type="url"
            value={destinationUrl}
            disabled={saving}
            placeholder="https://ridearrivo.com/"
            onChange={event=>{
              setDestinationUrl(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Source
          <input
            value={utmSource}
            maxLength={160}
            disabled={saving}
            placeholder="instagram"
            onChange={event=>{
              setUtmSource(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Medium
          <input
            value={utmMedium}
            maxLength={160}
            disabled={saving}
            placeholder="social"
            onChange={event=>{
              setUtmMedium(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Campaign UTM
          <input
            value={utmCampaign}
            maxLength={200}
            disabled={saving}
            placeholder="airport-arrival"
            onChange={event=>{
              setUtmCampaign(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Content UTM
          <input
            value={utmContent}
            maxLength={200}
            disabled={saving}
            placeholder="creator-video-a"
            onChange={event=>{
              setUtmContent(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Term
          <input
            value={utmTerm}
            maxLength={200}
            disabled={saving}
            placeholder="optional"
            onChange={event=>{
              setUtmTerm(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Tracking code
          <input
            value={trackingCode}
            maxLength={96}
            disabled={saving}
            placeholder="airport_creator_abc123"
            onChange={event=>{
              setTrackingCode(
                event.target.value
                  .toLowerCase()
                  .replace(
                    /[^a-z0-9_-]/g,
                    ''
                  )
              )
            }}
          />
        </label>
      </div>

      <div className="marketingGeneratedUrl">
        <span>
          {trackingUrlPreview ||
            'Complete destination, source, medium and campaign to preview the governed URL.'}
        </span>

        <button
          type="button"
          disabled={
            trackingUrlPreview==='' ||
            saving
          }
          onClick={()=>{
            void copyPreview()
          }}
        >
          <Copy size={15}/>
          Copy
        </button>
      </div>

      <div className="marketingIntelActions">
        <button
          type="button"
          disabled={
            loading ||
            saving ||
            campaignId==='' ||
            trackingUrlPreview==='' ||
            trackingCode.trim()===''
          }
          onClick={()=>{
            void createTrackingLink()
          }}
        >
          <Link2 size={16}/>
          {saving
            ? 'Creating...'
            : 'Create tracking link'}
        </button>
      </div>

      {notice &&
        <p
          className="marketingUtilityMessage"
          role="status"
        >
          {notice}
        </p>
      }
    </section>
  )
}

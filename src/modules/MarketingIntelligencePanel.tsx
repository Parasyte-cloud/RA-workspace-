import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

import '../marketing-intelligence.css'

type Campaign={
  id:string
  name:string
  status:string
}

type Creator={
  id:string
  display_name:string
  creator_code:string
  primary_platform:string|null
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

type Content={
  id:string
  title:string
}

type ContentCreator={
  id:string
  content_id:string
  campaign_creator_id:string
}

type TrackingLink={
  id:string
  campaign_id:string
  campaign_creator_id:string|null
  content_creator_id:string|null
  destination_url:string
  utm_source:string
  utm_medium:string
  utm_campaign:string
  utm_content:string|null
  utm_term:string|null
  tracking_code:string
  status:string
}

type Snapshot={
  id:string
  reach:number|string|null
  impressions:number|string|null
  engagements:number|string|null
  link_clicks:number|string|null
  supersedes_snapshot_id:string|null
}

type AttributionLink={
  id:string
  attribution_id:string
  campaign_id:string
  campaign_creator_id:string|null
  content_creator_id:string|null
  tracking_link_id:string|null
  utm_content:string|null
  attribution_model:string
}

type Attribution={
  id:string
  campaign_name:string
  spend:number|string|null
  bookings:number|string|null
  revenue:number|string|null
}

function n(value:number|string|null|undefined){
  const parsed=Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function MarketingIntelligencePanel(){
  const [campaigns,setCampaigns]=useState<Campaign[]>([])
  const [creators,setCreators]=useState<Creator[]>([])
  const [campaignCreators,setCampaignCreators]=
    useState<CampaignCreator[]>([])
  const [contents,setContents]=useState<Content[]>([])
  const [contentCreators,setContentCreators]=
    useState<ContentCreator[]>([])
  const [trackingLinks,setTrackingLinks]=
    useState<TrackingLink[]>([])
  const [snapshots,setSnapshots]=useState<Snapshot[]>([])
  const [attribution,setAttribution]=useState<Attribution[]>([])
  const [attributionLinks,setAttributionLinks]=
    useState<AttributionLink[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  const load=useCallback(async()=>{
    const client=supabase

    if(!client){
      setError('Marketing intelligence database is unavailable.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    const [c1,c2,c3,c4,c5,c6,c7,c8,c9]=await Promise.all([
      client
        .from('marketing_campaigns')
        .select('id,name,status'),
      client
        .from('marketing_creators')
        .select(
          'id,display_name,creator_code,primary_platform,status'
        ),
      client
        .from('marketing_campaign_creators')
        .select(
          'id,campaign_id,creator_id,relationship_type,tracking_code,status'
        ),
      client
        .from('marketing_content')
        .select(
          'id,title'
        ),
      client
        .from('marketing_content_creators')
        .select(
          'id,content_id,campaign_creator_id'
        ),
      client
        .from('marketing_tracking_links')
        .select(
          'id,campaign_id,campaign_creator_id,content_creator_id,destination_url,utm_source,utm_medium,utm_campaign,utm_content,utm_term,tracking_code,status'
        ),
      client
        .from('marketing_performance_snapshots')
        .select(
          'id,reach,impressions,engagements,link_clicks,supersedes_snapshot_id'
        ),
      client
        .from('marketing_attribution')
        .select(
          'id,campaign_name,spend,bookings,revenue'
        ),
      client
        .from('marketing_attribution_links')
        .select(
          'id,attribution_id,campaign_id,campaign_creator_id,content_creator_id,tracking_link_id,utm_content,attribution_model'
        )
    ])

    const failure=
      c1.error
      || c2.error
      || c3.error
      || c4.error
      || c5.error
      || c6.error
      || c7.error
      || c8.error
      || c9.error

    if(failure){
      setError(failure.message)
      setLoading(false)
      return
    }

    setCampaigns((c1.data || []) as Campaign[])
    setCreators((c2.data || []) as Creator[])
    setCampaignCreators(
      (c3.data || []) as CampaignCreator[]
    )
    setContents(
      (c4.data || []) as Content[]
    )
    setContentCreators(
      (c5.data || []) as ContentCreator[]
    )
    setTrackingLinks(
      (c6.data || []) as TrackingLink[]
    )
    setSnapshots((c7.data || []) as Snapshot[])
    setAttribution((c8.data || []) as Attribution[])
    setAttributionLinks(
      (c9.data || []) as AttributionLink[]
    )
    setLoading(false)
  },[])

  useEffect(()=>{
    void load()
  },[load])

  const contentIds=
    new Set(
      contents.map(row=>row.id)
    )

  const campaignCreatorIds=
    new Set(
      campaignCreators.map(row=>row.id)
    )

  const linkedContentCount=
    new Set(
      contentCreators
        .filter(
          row=>
            contentIds.has(row.content_id)
            && campaignCreatorIds.has(
              row.campaign_creator_id
            )
        )
        .map(row=>row.content_id)
    ).size

  const activeTrackingLinks=
    trackingLinks.filter(
      row=>row.status==='active'
    ).length

  const supersededSnapshotIds=
    new Set(
      snapshots
        .map(
          row=>row.supersedes_snapshot_id
        )
        .filter(
          (id):id is string=>Boolean(id)
        )
    )

  const currentSnapshots=
    snapshots.filter(
      row=>!supersededSnapshotIds.has(row.id)
    )

  const reach=
    currentSnapshots.reduce(
      (sum,row)=>sum+n(row.reach),
      0
    )

  const bookings=
    attribution.reduce(
      (sum,row)=>sum+n(row.bookings),
      0
    )

  const revenue=
    attribution.reduce(
      (sum,row)=>sum+n(row.revenue),
      0
    )

  const creatorAttributionIds=
    new Set(
      attributionLinks
        .filter(row=>row.campaign_creator_id!==null)
        .map(row=>row.attribution_id)
    )

  const creatorAttributedBookings=
    attribution
      .filter(row=>creatorAttributionIds.has(row.id))
      .reduce(
        (sum,row)=>sum+n(row.bookings),
        0
      )

  const creatorAttributedRevenue=
    attribution
      .filter(row=>creatorAttributionIds.has(row.id))
      .reduce(
        (sum,row)=>sum+n(row.revenue),
        0
      )

  return (
    <section className="marketingIntel">
      <header>
        <div>
          <span className="eyebrow">
            CAMPAIGN & INFLUENCER INTELLIGENCE
          </span>
          <h2>Creator reach to attributed revenue</h2>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={()=>void load()}
        >
          <RefreshCw size={16}/>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </header>

      {error && <p>{error}</p>}

      <div className="marketingIntelMetrics">
        <article>
          <span>Creators</span>
          <strong>{creators.length}</strong>
        </article>

        <article>
          <span>Live campaigns</span>
          <strong>
            {campaigns.filter(
              row=>row.status==='live'
            ).length}
          </strong>
        </article>

        <article>
          <span>Creator assignments</span>
          <strong>{campaignCreators.length}</strong>
        </article>

        <article>
          <span>Creator-linked content</span>
          <strong>{linkedContentCount}</strong>
        </article>

        <article>
          <span>Active tracking links</span>
          <strong>{activeTrackingLinks}</strong>
        </article>

        <article>
          <span>Reach</span>
          <strong>{reach}</strong>
        </article>

        <article>
          <span>Creator-attributed bookings</span>
          <strong>{creatorAttributedBookings}</strong>
        </article>

        <article>
          <span>Creator-attributed revenue</span>
          <strong>{creatorAttributedRevenue}</strong>
        </article>

        <article>
          <span>Bookings</span>
          <strong>{bookings}</strong>
        </article>

        <article>
          <span>Attributed revenue</span>
          <strong>{revenue}</strong>
        </article>
      </div>
    </section>
  )
}

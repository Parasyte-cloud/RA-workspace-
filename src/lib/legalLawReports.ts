import { supabase } from './supabase'

export type LegalRisk =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'

export type LegalVerificationStatus =
  | 'draft'
  | 'source_verified'
  | 'reviewed'
  | 'approved'
  | 'superseded'
  | 'archived'

export type LegalConfidentiality =
  | 'internal'
  | 'privileged'

export type LegalLawReport = {
  id:string
  report_title:string
  case_name:string
  citation:string|null
  neutral_citation:string|null
  court:string
  jurisdiction:string
  decision_date:string|null
  judges:string[]
  practice_areas:string[]
  material_facts:string|null
  issues_for_determination:string|null
  parties_arguments:string|null
  statutes_considered:string|null
  authorities_considered:string|null
  holding:string|null
  ratio_decidendi:string|null
  obiter_dicta:string|null
  orders_made:string|null
  legal_principle:string|null
  appeal_status:string|null
  ridearrivo_relevance:string|null
  operational_impact:string|null
  recommendation:string|null
  risk_rating:LegalRisk
  source_url:string|null
  secondary_source_url:string|null
  verification_status:LegalVerificationStatus
  confidentiality:LegalConfidentiality
  prepared_by:string|null
  source_verified_by:string|null
  reviewed_by:string|null
  approved_by:string|null
  source_verified_at:string|null
  reviewed_at:string|null
  approved_at:string|null
  created_at:string
  updated_at:string
}

export type LegalReportSource = {
  id:string
  report_id:string
  source_type:
    | 'judgment'
    | 'statute'
    | 'regulation'
    | 'official_notice'
    | 'gazette'
    | 'secondary'
  title:string
  citation:string|null
  source_url:string|null
  is_primary:boolean
  verification_status:'unverified'|'verified'
  notes:string|null
  created_by:string|null
  verified_by:string|null
  verified_at:string|null
  created_at:string
}

export type LegalStatute = {
  id:string
  title:string
  instrument_type:string
  regulator:string|null
  jurisdiction:string
  reference_number:string|null
  commencement_date:string|null
  status:
    | 'proposed'
    | 'in_force'
    | 'amended'
    | 'repealed'
    | 'superseded'
  summary:string|null
  key_provisions:string|null
  ridearrivo_impact:string|null
  required_action:string|null
  risk_rating:LegalRisk
  source_url:string|null
  verification_status:LegalVerificationStatus
  created_by:string|null
  reviewed_by:string|null
  approved_by:string|null
  created_at:string
  updated_at:string
}

export type LegalResearchOpinion = {
  id:string
  title:string
  question_presented:string
  background:string|null
  applicable_law:string|null
  authorities:string|null
  analysis:string|null
  conclusion:string|null
  recommendation:string|null
  risk_rating:LegalRisk
  privileged:boolean
  status:
    | 'draft'
    | 'in_review'
    | 'approved'
    | 'superseded'
    | 'archived'
  author_id:string|null
  reviewer_id:string|null
  approved_by:string|null
  reviewed_at:string|null
  approved_at:string|null
  created_at:string
  updated_at:string
}

export type LegalReportVersion = {
  id:number
  report_id:string
  version_number:number
  snapshot:Record<string,unknown>
  created_by:string|null
  created_at:string
}

export type LegalAuditEvent = {
  id:number
  entity_type:string
  entity_id:string
  action:'INSERT'|'UPDATE'|'DELETE'
  actor_id:string|null
  previous_data:Record<string,unknown>|null
  new_data:Record<string,unknown>|null
  created_at:string
}

export type LegalWorkspaceRole =
  | 'legal'
  | 'manager'
  | 'admin'
  | string
  | null

export type NewLawReport = {
  report_title:string
  case_name:string
  citation?:string|null
  neutral_citation?:string|null
  court:string
  jurisdiction?:string
  decision_date?:string|null
  judges?:string[]
  practice_areas?:string[]
  material_facts?:string|null
  issues_for_determination?:string|null
  parties_arguments?:string|null
  statutes_considered?:string|null
  authorities_considered?:string|null
  holding?:string|null
  ratio_decidendi?:string|null
  obiter_dicta?:string|null
  orders_made?:string|null
  legal_principle?:string|null
  appeal_status?:string|null
  ridearrivo_relevance?:string|null
  operational_impact?:string|null
  recommendation?:string|null
  risk_rating?:LegalRisk
  source_url?:string|null
  secondary_source_url?:string|null
  confidentiality?:LegalConfidentiality
}

function client(){
  if(!supabase){
    throw new Error(
      'Legal workspace service is unavailable'
    )
  }

  return supabase
}

function clean(value:string|undefined|null){
  const next=(value || '').trim()
  return next || null
}

export function legalErrorMessage(error:unknown){
  const raw=
    error instanceof Error
      ? error.message
      : String(error || '')

  const value=raw.toLowerCase()

  if(
    value.includes('jwt') ||
    value.includes('session') ||
    value.includes('authentication') ||
    value.includes('not authenticated')
  ){
    return 'Your session has expired. Sign in again and retry.'
  }

  if(
    value.includes('permission') ||
    value.includes('row-level security') ||
    value.includes('rls') ||
    value.includes('forbidden') ||
    value.includes('not allowed')
  ){
    return 'You do not have permission to perform this legal workspace action.'
  }

  if(
    value.includes('failed to fetch') ||
    value.includes('network') ||
    value.includes('offline')
  ){
    return 'We could not reach the Legal workspace. Check your connection and try again.'
  }

  if(
    value.includes('must begin as draft') ||
    value.includes('source verified before review') ||
    value.includes('reviewed before approval') ||
    value.includes('primary or verified source')
  ){
    return raw
  }

  if(
    value.includes('immutable') ||
    value.includes('cannot be edited') ||
    value.includes('cannot be modified')
  ){
    return raw
  }

  return 'The Legal workspace is temporarily unavailable. Please try again.'
}

function throwIfError(
  error:{message:string}|null
){
  if(error){
    throw new Error(error.message)
  }
}

export async function loadLegalWorkspaceRole(){
  const db=client()

  const {
    data,
    error
  }=await db.rpc(
    'current_workspace_role'
  )

  throwIfError(error)

  return (data || null) as LegalWorkspaceRole
}

export async function loadLawReports(){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_law_reports')
    .select('*')
    .order(
      'updated_at',
      {ascending:false}
    )

  throwIfError(error)

  return (data || []) as LegalLawReport[]
}

export async function loadLawReport(
  id:string
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_law_reports')
    .select('*')
    .eq('id',id)
    .single()

  throwIfError(error)

  return data as LegalLawReport
}

export async function createLawReport(
  values:NewLawReport
){
  const db=client()

  const payload={
    report_title:values.report_title.trim(),
    case_name:values.case_name.trim(),
    citation:clean(values.citation),
    neutral_citation:clean(
      values.neutral_citation
    ),
    court:values.court.trim(),
    jurisdiction:
      values.jurisdiction?.trim() ||
      'Nigeria',
    decision_date:
      clean(values.decision_date),
    judges:
      values.judges || [],
    practice_areas:
      values.practice_areas || [],
    material_facts:
      clean(values.material_facts),
    issues_for_determination:
      clean(values.issues_for_determination),
    parties_arguments:
      clean(values.parties_arguments),
    statutes_considered:
      clean(values.statutes_considered),
    authorities_considered:
      clean(values.authorities_considered),
    holding:
      clean(values.holding),
    ratio_decidendi:
      clean(values.ratio_decidendi),
    obiter_dicta:
      clean(values.obiter_dicta),
    orders_made:
      clean(values.orders_made),
    legal_principle:
      clean(values.legal_principle),
    appeal_status:
      clean(values.appeal_status),
    ridearrivo_relevance:
      clean(values.ridearrivo_relevance),
    operational_impact:
      clean(values.operational_impact),
    recommendation:
      clean(values.recommendation),
    risk_rating:
      values.risk_rating || 'low',
    source_url:
      clean(values.source_url),
    secondary_source_url:
      clean(values.secondary_source_url),
    confidentiality:
      values.confidentiality || 'internal',
    verification_status:'draft' as const,
  }

  const {
    data,
    error
  }=await db
    .from('legal_law_reports')
    .insert(payload)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalLawReport
}

export async function updateLawReport(
  id:string,
  values:Partial<NewLawReport>
){
  const db=client()

  const payload:Record<string,unknown>={}

  if(values.report_title!==undefined){
    payload.report_title=
      values.report_title.trim()
  }

  if(values.case_name!==undefined){
    payload.case_name=
      values.case_name.trim()
  }

  if(values.citation!==undefined){
    payload.citation=
      clean(values.citation)
  }

  if(values.neutral_citation!==undefined){
    payload.neutral_citation=
      clean(values.neutral_citation)
  }

  if(values.court!==undefined){
    payload.court=
      values.court.trim()
  }

  if(values.jurisdiction!==undefined){
    payload.jurisdiction=
      values.jurisdiction.trim()
  }

  if(values.decision_date!==undefined){
    payload.decision_date=
      clean(values.decision_date)
  }

  if(values.judges!==undefined){
    payload.judges=
      values.judges
  }

  if(values.practice_areas!==undefined){
    payload.practice_areas=
      values.practice_areas
  }

  const textFields=[
    'material_facts',
    'issues_for_determination',
    'parties_arguments',
    'statutes_considered',
    'authorities_considered',
    'holding',
    'ratio_decidendi',
    'obiter_dicta',
    'orders_made',
    'legal_principle',
    'appeal_status',
    'ridearrivo_relevance',
    'operational_impact',
    'recommendation',
    'source_url',
    'secondary_source_url',
  ] as const

  for(const field of textFields){
    if(values[field]!==undefined){
      payload[field]=clean(values[field])
    }
  }

  if(values.risk_rating!==undefined){
    payload.risk_rating=
      values.risk_rating
  }

  if(values.confidentiality!==undefined){
    payload.confidentiality=
      values.confidentiality
  }

  const {
    data,
    error
  }=await db
    .from('legal_law_reports')
    .update(payload)
    .eq('id',id)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalLawReport
}

export async function transitionLawReport(
  id:string,
  status:LegalVerificationStatus
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_law_reports')
    .update({
      verification_status:status,
    })
    .eq('id',id)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalLawReport
}

export async function loadReportSources(
  reportId:string
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_law_report_sources')
    .select('*')
    .eq('report_id',reportId)
    .order(
      'created_at',
      {ascending:false}
    )

  throwIfError(error)

  return (data || []) as LegalReportSource[]
}

export async function addReportSource(
  reportId:string,
  values:{
    source_type:LegalReportSource['source_type']
    title:string
    citation?:string|null
    source_url?:string|null
    is_primary?:boolean
    notes?:string|null
  }
){
  const db=client()

  const {
    data:{
      user
    },
  }=await db.auth.getUser()

  if(!user){
    throw new Error(
      'Authentication is required'
    )
  }

  const {
    data,
    error
  }=await db
    .from('legal_law_report_sources')
    .insert({
      report_id:reportId,
      source_type:values.source_type,
      title:values.title.trim(),
      citation:clean(values.citation),
      source_url:clean(values.source_url),
      is_primary:
        values.is_primary || false,
      notes:clean(values.notes),
      created_by:user.id,
    })
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalReportSource
}

export async function loadLegalStatutes(){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_statutes_regulations')
    .select('*')
    .order(
      'updated_at',
      {ascending:false}
    )

  throwIfError(error)

  return (data || []) as LegalStatute[]
}

export async function loadLegalOpinions(){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_research_opinions')
    .select('*')
    .order(
      'updated_at',
      {ascending:false}
    )

  throwIfError(error)

  return (data || []) as LegalResearchOpinion[]
}

export async function loadReportVersions(
  reportId:string
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_law_report_versions')
    .select('*')
    .eq('report_id',reportId)
    .order(
      'version_number',
      {ascending:false}
    )

  throwIfError(error)

  return (data || []) as LegalReportVersion[]
}

export async function loadLegalAudit(
  entityId?:string
){
  const db=client()

  let query=db
    .from('legal_law_report_audit')
    .select('*')
    .order(
      'created_at',
      {ascending:false}
    )
    .limit(100)

  if(entityId){
    query=query.eq(
      'entity_id',
      entityId
    )
  }

  const {
    data,
    error
  }=await query

  throwIfError(error)

  return (data || []) as LegalAuditEvent[]
}

export type NewLegalStatute = {
  title:string
  instrument_type:string
  regulator?:string|null
  jurisdiction?:string
  reference_number?:string|null
  commencement_date?:string|null
  status?:
    | 'proposed'
    | 'in_force'
    | 'amended'
    | 'repealed'
    | 'superseded'
  summary?:string|null
  key_provisions?:string|null
  ridearrivo_impact?:string|null
  required_action?:string|null
  risk_rating?:LegalRisk
  source_url?:string|null
}

export type NewLegalOpinion = {
  title:string
  question_presented:string
  background?:string|null
  applicable_law?:string|null
  authorities?:string|null
  analysis?:string|null
  conclusion?:string|null
  recommendation?:string|null
  risk_rating?:LegalRisk
  privileged?:boolean
}

export async function createLegalStatute(
  values:NewLegalStatute
){
  const db=client()

  const {
    data:{
      user
    },
  }=await db.auth.getUser()

  if(!user){
    throw new Error(
      'Authentication is required'
    )
  }

  const {
    data,
    error
  }=await db
    .from('legal_statutes_regulations')
    .insert({
      title:values.title.trim(),
      instrument_type:
        values.instrument_type.trim(),
      regulator:clean(values.regulator),
      jurisdiction:
        values.jurisdiction?.trim() ||
        'Nigeria',
      reference_number:
        clean(values.reference_number),
      commencement_date:
        clean(values.commencement_date),
      status:
        values.status || 'in_force',
      summary:
        clean(values.summary),
      key_provisions:
        clean(values.key_provisions),
      ridearrivo_impact:
        clean(values.ridearrivo_impact),
      required_action:
        clean(values.required_action),
      risk_rating:
        values.risk_rating || 'low',
      source_url:
        clean(values.source_url),
      verification_status:'draft',
      created_by:user.id,
    })
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalStatute
}

export async function updateLegalStatute(
  id:string,
  values:Partial<NewLegalStatute>
){
  const db=client()

  const payload:Record<string,unknown>={}

  if(values.title!==undefined){
    payload.title=
      values.title.trim()
  }

  if(values.instrument_type!==undefined){
    payload.instrument_type=
      values.instrument_type.trim()
  }

  if(values.regulator!==undefined){
    payload.regulator=
      clean(values.regulator)
  }

  if(values.jurisdiction!==undefined){
    payload.jurisdiction=
      values.jurisdiction.trim()
  }

  if(values.reference_number!==undefined){
    payload.reference_number=
      clean(values.reference_number)
  }

  if(values.commencement_date!==undefined){
    payload.commencement_date=
      clean(values.commencement_date)
  }

  if(values.status!==undefined){
    payload.status=
      values.status
  }

  if(values.summary!==undefined){
    payload.summary=
      clean(values.summary)
  }

  if(values.key_provisions!==undefined){
    payload.key_provisions=
      clean(values.key_provisions)
  }

  if(values.ridearrivo_impact!==undefined){
    payload.ridearrivo_impact=
      clean(values.ridearrivo_impact)
  }

  if(values.required_action!==undefined){
    payload.required_action=
      clean(values.required_action)
  }

  if(values.risk_rating!==undefined){
    payload.risk_rating=
      values.risk_rating
  }

  if(values.source_url!==undefined){
    payload.source_url=
      clean(values.source_url)
  }

  const {
    data,
    error
  }=await db
    .from('legal_statutes_regulations')
    .update(payload)
    .eq('id',id)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalStatute
}

export async function createLegalOpinion(
  values:NewLegalOpinion
){
  const db=client()

  const {
    data:{
      user
    },
  }=await db.auth.getUser()

  if(!user){
    throw new Error(
      'Authentication is required'
    )
  }

  const {
    data,
    error
  }=await db
    .from('legal_research_opinions')
    .insert({
      title:values.title.trim(),
      question_presented:
        values.question_presented.trim(),
      background:
        clean(values.background),
      applicable_law:
        clean(values.applicable_law),
      authorities:
        clean(values.authorities),
      analysis:
        clean(values.analysis),
      conclusion:
        clean(values.conclusion),
      recommendation:
        clean(values.recommendation),
      risk_rating:
        values.risk_rating || 'low',
      privileged:
        values.privileged !== false,
      status:'draft',
      author_id:user.id,
    })
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalResearchOpinion
}

export async function updateLegalOpinion(
  id:string,
  values:Partial<NewLegalOpinion>
){
  const db=client()

  const payload:Record<string,unknown>={}

  if(values.title!==undefined){
    payload.title=
      values.title.trim()
  }

  if(values.question_presented!==undefined){
    payload.question_presented=
      values.question_presented.trim()
  }

  if(values.background!==undefined){
    payload.background=
      clean(values.background)
  }

  if(values.applicable_law!==undefined){
    payload.applicable_law=
      clean(values.applicable_law)
  }

  if(values.authorities!==undefined){
    payload.authorities=
      clean(values.authorities)
  }

  if(values.analysis!==undefined){
    payload.analysis=
      clean(values.analysis)
  }

  if(values.conclusion!==undefined){
    payload.conclusion=
      clean(values.conclusion)
  }

  if(values.recommendation!==undefined){
    payload.recommendation=
      clean(values.recommendation)
  }

  if(values.risk_rating!==undefined){
    payload.risk_rating=
      values.risk_rating
  }

  if(values.privileged!==undefined){
    payload.privileged=
      values.privileged
  }

  const {
    data,
    error
  }=await db
    .from('legal_research_opinions')
    .update(payload)
    .eq('id',id)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalResearchOpinion
}

export async function verifyReportSource(
  sourceId:string,
  verified:boolean
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_law_report_sources')
    .update({
      verification_status:
        verified
          ? 'verified'
          : 'unverified',
    })
    .eq('id',sourceId)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalReportSource
}


export async function transitionLegalStatute(
  id:string,
  status:LegalVerificationStatus
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_statutes_regulations')
    .update({
      verification_status:status,
    })
    .eq('id',id)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalStatute
}


export async function transitionLegalOpinion(
  id:string,
  status:LegalResearchOpinion['status']
){
  const db=client()

  const {
    data,
    error
  }=await db
    .from('legal_research_opinions')
    .update({
      status,
    })
    .eq('id',id)
    .select('*')
    .single()

  throwIfError(error)

  return data as LegalResearchOpinion
}

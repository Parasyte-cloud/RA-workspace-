export type CeremonySourceKind =
  | 'department_achievement'
  | 'personal_award'
  | 'company_recognition'
  | 'company_milestone'
  | 'seasonal_campaign'
  | 'birthday'

export type CeremonyPresentation = {
  deliveryId: string
  sourceKind: CeremonySourceKind
  sourceId?: string | null
  sourceKey?: string | null
  audienceType: 'department' | 'individual' | 'company'
  priority: number
  revision: number
  title: string
  message?: string | null
  detail?: string | null
  department?: string | null
  tier?: string | null
  achievementKind?: string | null
  awardCategory?: string | null
  badgeLabel?: string | null
  earnedAt?: string | null
  awardedAt?: string | null
  campaignType?: 'christmas' | 'new_year' | null
  campaignYear?: number | null
  variant?: 'christmas' | 'live_midnight' | 'delayed' | null
  employeeName?: string | null
  photoUrl?: string | null
}

export type CeremonyClaimRow = {
  delivery_id: string
  source_kind: CeremonySourceKind
  source_id?: string | null
  source_key?: string | null
  audience_type: 'department' | 'individual' | 'company'
  priority: number
  revision: number
  title: string
  message?: string | null
  detail?: string | null
  department?: string | null
  tier?: string | null
  achievement_kind?: string | null
  award_category?: string | null
  badge_label?: string | null
  earned_at?: string | null
  awarded_at?: string | null
  campaign_type?: 'christmas' | 'new_year' | null
  campaign_year?: number | null
  variant?: 'christmas' | 'live_midnight' | 'delayed' | null
  employee_name?: string | null
  photo_url?: string | null
}

export function normalizeCeremonyClaim(row: CeremonyClaimRow): CeremonyPresentation {
  return {
    deliveryId: row.delivery_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id ?? null,
    sourceKey: row.source_key ?? null,
    audienceType: row.audience_type,
    priority: Number(row.priority || 0),
    revision: Number(row.revision || 1),
    title: row.title || 'RideArrivo recognition',
    message: row.message ?? null,
    detail: row.detail ?? null,
    department: row.department ?? null,
    tier: row.tier ?? null,
    achievementKind: row.achievement_kind ?? null,
    awardCategory: row.award_category ?? null,
    badgeLabel: row.badge_label ?? null,
    earnedAt: row.earned_at ?? null,
    awardedAt: row.awarded_at ?? null,
    campaignType: row.campaign_type ?? null,
    campaignYear: row.campaign_year == null ? null : Number(row.campaign_year),
    variant: row.variant ?? null,
    employeeName: row.employee_name ?? null,
    photoUrl: row.photo_url ?? null,
  }
}

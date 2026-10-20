export type CeremonySourceKind =
  | 'department_achievement'
  | 'personal_award'
  | 'company_recognition'
  | 'company_milestone'

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
  }
}

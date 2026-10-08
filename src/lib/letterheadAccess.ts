// Who may issue documents on the RideArrivo letterhead. One list, used by the
// workspace navigation, the module itself and (mirrored) the database policy
// in supabase/migrations/20261008120000_letterhead_issue_log.sql. To widen
// access, add the role here AND in that policy's role list.
export const LETTERHEAD_ROLES = ['admin', 'legal', 'operations', 'finance'] as const

export const canUseLetterhead = (role: string | null | undefined): boolean =>
  LETTERHEAD_ROLES.includes(String(role ?? '').toLowerCase() as (typeof LETTERHEAD_ROLES)[number])

import { supabase } from './supabase'

export type VaultPerson = { id: string; full_name: string | null; email: string | null }
export type VaultRequest = {
  id: string
  requester_id: string
  owner_id: string
  item_id: string | null
  note: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  created_at: string
  decided_at: string | null
}
export type VaultShare = { acl_id: string; employee_id: string; full_name: string | null; expires_at: string | null; created_at: string }
export type MyShare = { id: string; item_id: string; expires_at: string | null }

// 5 minutes to 7 days. The database enforces the same limits; this only turns
// "2 hours" typed by a person into minutes and rejects nonsense early.
export const MIN_SHARE_MINUTES = 5
export const MAX_SHARE_MINUTES = 7 * 24 * 60
export type ShareUnit = 'minutes' | 'hours' | 'days'
export function shareMinutes(amount: number, unit: ShareUnit): number | null {
  const factor = unit === 'days' ? 1440 : unit === 'hours' ? 60 : 1
  const minutes = Math.round(Number(amount) * factor)
  if (!Number.isFinite(minutes) || minutes < MIN_SHARE_MINUTES || minutes > MAX_SHARE_MINUTES) return null
  return minutes
}

const need = () => {
  if (!supabase) throw new Error('Supabase unavailable')
  return supabase
}
const check = <T,>(res: { data: T; error: { message: string } | null }) => {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

export async function currentUserId(): Promise<string> {
  const { data } = await need().auth.getUser()
  if (!data.user) throw new Error('Sign in required')
  return data.user.id
}

export async function listPeople(): Promise<VaultPerson[]> {
  const res = await need().from('employee_profiles').select('id,full_name,email').eq('active', true).order('full_name')
  return (check(res) || []) as VaultPerson[]
}
export async function listRequests(): Promise<VaultRequest[]> {
  const res = await need().from('secret_vault_access_requests').select('*').order('created_at', { ascending: false }).limit(100)
  return (check(res) || []) as VaultRequest[]
}
export async function listMyShares(): Promise<MyShare[]> {
  const uid = await currentUserId()
  const res = await need().from('secret_vault_acl').select('id,item_id,expires_at,revoked_at,can_reveal').eq('employee_id', uid).eq('can_reveal', true).is('revoked_at', null)
  const now = Date.now()
  return ((check(res) || []) as (MyShare & { revoked_at: string | null })[]).filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
}
export async function listItemShares(item_id: string): Promise<VaultShare[]> {
  const res = await need().rpc('vault_item_shares', { target_item: item_id })
  return (check(res) || []) as VaultShare[]
}
export const requestAccess = async (owner: string, note: string) =>
  check(await need().rpc('vault_request_access', { target_owner: owner, request_note: note }))
export const grantAccess = async (item_id: string, grantee: string, minutes: number, request?: string) =>
  check(await need().rpc('vault_grant_access', { target_item: item_id, grantee, duration_minutes: minutes, for_request: request ?? null }))
export const revokeAccess = async (acl_id: string) => check(await need().rpc('vault_revoke_access', { target_acl: acl_id }))
export const closeRequest = async (id: string, decision: 'declined' | 'cancelled') =>
  check(await need().rpc('vault_close_request', { target_request: id, decision }))

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

// Who is looking, and whether they are an administrator. Used to show the
// Delete button only to people the server would let delete.
export async function currentViewer(): Promise<{ id: string; isAdmin: boolean }> {
  const id = await currentUserId()
  const res = await need().from('employee_profiles').select('role').eq('id', id).maybeSingle()
  const role = String((res.data as { role?: string } | null)?.role || '').toLowerCase()
  return { id, isAdmin: role === 'admin' }
}

// Turns a raw database message into words a person can act on. A missing
// grant or a migration that has not been applied yet is the usual cause when a
// part of the vault fails to load, and "permission denied for table x" tells
// nobody what to do.
export function friendlySharingError(message: string, what: string): string {
  const text = String(message || '')
  if (/permission denied|does not exist|could not find the function|schema cache|not found/i.test(text)) {
    return `${what} could not load because the latest vault database update has not been applied yet. Ask an administrator to run it.`
  }
  if (/jwt|not authenticated|sign in/i.test(text)) return 'Your session expired. Sign in again.'
  return `${what} could not load: ${text}`
}

// The staff list is read straight from the directory. If that is refused, the
// vault's own people function (security definer, active staff only) is used.
export async function listPeople(): Promise<VaultPerson[]> {
  const client = need()
  const direct = await client.from('employee_profiles').select('id,full_name,email').eq('active', true).order('full_name')
  if (!direct.error && direct.data) return direct.data as VaultPerson[]
  const viaFunction = await client.rpc('vault_people')
  if (!viaFunction.error && viaFunction.data) return viaFunction.data as VaultPerson[]
  throw new Error(direct.error?.message || viaFunction.error?.message || 'Could not read the staff list')
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

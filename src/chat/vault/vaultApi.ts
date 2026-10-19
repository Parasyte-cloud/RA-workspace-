import { supabase } from '../../lib/supabase'
import type { VaultItem } from './vaultFormat'

export type VaultFailure = { ok: false; code: string; error: string; attempts_left?: number | null }
export type VaultReply<T> = (T & { ok: true }) | VaultFailure

export type Opened =
  | { kind: 'text'; text: string; expires_at: string; seconds_left: number; viewer: { name: string } }
  | { kind: 'file'; mime: string; name: string; url: string; expires_at: string; seconds_left: number; viewer: { name: string } }

export type VaultSettings = { max_view_seconds: number; max_attempts: number }

export type AdminItem = {
  item_id: string
  conversation_id: string
  conversation_title: string
  participants: string | null
  sender_id: string
  sender_name: string | null
  kind: 'text' | 'file'
  status: string
  view_seconds: number
  failed_attempts: number
  unblock_count: number
  opened_by_name: string | null
  opened_at: string | null
  open_requests: number
  created_at: string
}

export type AuditRow = {
  id: number
  created_at: string
  event: string
  actor_name: string | null
  item_id: string | null
  conversation_title: string | null
  detail: Record<string, unknown>
}

const ITEM_COLUMNS = 'id,message_id,conversation_id,sender_id,kind,mime,status,view_seconds,opened_by,opened_at,failed_attempts,unblock_count'

// Every call to the vault goes through the edge function. Expected refusals
// (wrong key, locked) come back as { ok: false } with words for the person.
export async function callVault<T>(action: string, payload: Record<string, unknown>): Promise<VaultReply<T>> {
  const client = supabase
  if (!client) return { ok: false, code: 'config', error: 'Workspace authentication is not configured.' }
  const { data, error } = await client.functions.invoke('confidential-vault', { body: { action, ...payload } })
  if (error) {
    const response = (error as { context?: unknown }).context
    if (response instanceof Response) {
      const body = await response.clone().json().catch(() => null)
      if (body && typeof body.error === 'string') {
        return { ok: false, code: String(body.code || 'failed'), error: body.error, attempts_left: body.attempts_left ?? null }
      }
    }
    return { ok: false, code: 'network', error: 'Could not reach the vault. Check your connection and try again.' }
  }
  if (data && typeof data === 'object' && 'ok' in data) return data as VaultReply<T>
  return { ok: false, code: 'failed', error: 'The vault returned an unexpected answer.' }
}

// Null means the vault is not set up on the server yet (the SQL has not been
// run). The lock button stays hidden in that case, so nothing half-works.
export async function loadVaultSettings(): Promise<VaultSettings | null> {
  const client = supabase
  if (!client) return null
  const { data, error } = await client.from('confidential_settings').select('max_view_seconds,max_attempts').maybeSingle()
  if (error || !data) return null
  return data as VaultSettings
}

// The state of every locked card in a chat (never what is inside).
export async function loadVaultItems(conversationId: string): Promise<VaultItem[]> {
  const client = supabase
  if (!client || !conversationId) return []
  const { data, error } = await client
    .from('confidential_items')
    .select(ITEM_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(400)
  if (error) return []
  return (data || []) as VaultItem[]
}

export function watchVaultItems(conversationId: string, onRow: (row: VaultItem) => void): () => void {
  const client = supabase
  if (!client || !conversationId) return () => undefined
  const channel = client
    .channel(`vault-${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'confidential_items', filter: `conversation_id=eq.${conversationId}` },
      payload => { if (payload.new && (payload.new as VaultItem).id) onRow(payload.new as VaultItem) }
    )
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

export async function requestAccess(itemId: string): Promise<string> {
  const client = supabase
  if (!client) return 'Workspace authentication is not configured.'
  const { error } = await client.rpc('vault_request_access', { p_item: itemId })
  return error ? error.message : ''
}

export async function listAdminItems(): Promise<{ rows: AdminItem[]; error: string }> {
  const client = supabase
  if (!client) return { rows: [], error: 'Workspace authentication is not configured.' }
  const { data, error } = await client.rpc('vault_admin_list', { p_limit: 300 })
  if (error) return { rows: [], error: /does not exist|schema cache/i.test(error.message) ? 'Run migration 20261019100000_confidential_messages.sql first.' : error.message }
  return { rows: (data || []) as AdminItem[], error: '' }
}

export async function listAudit(itemId: string | null): Promise<AuditRow[]> {
  const client = supabase
  if (!client) return []
  const { data } = await client.rpc('vault_admin_audit', { p_item: itemId, p_limit: 300 })
  return (data || []) as AuditRow[]
}

export async function saveVaultSettings(settings: VaultSettings): Promise<string> {
  const client = supabase
  if (!client) return 'Workspace authentication is not configured.'
  const { error } = await client.rpc('vault_admin_set_settings', {
    p_max_view_seconds: settings.max_view_seconds,
    p_max_attempts: settings.max_attempts
  })
  return error ? error.message : ''
}

// Sends one confidential file: ask for an upload address, upload straight to the
// private bucket, then let the server check what arrived and post the card.
export async function sendConfidentialFile(
  conversationId: string,
  file: File,
  mime: string,
  viewSeconds: number
): Promise<VaultReply<{ key: string; item_id: string; message_id: string }>> {
  const client = supabase
  if (!client) return { ok: false, code: 'config', error: 'Workspace authentication is not configured.' }
  const prepared = await callVault<{ item_id: string; path: string; token: string }>('prepare_file', {
    conversation_id: conversationId,
    file_name: file.name,
    mime,
    size: file.size,
    view_seconds: viewSeconds
  })
  if (!prepared.ok) return prepared
  const upload = await client.storage
    .from('confidential-vault')
    .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: mime })
  if (upload.error) {
    return { ok: false, code: 'upload', error: 'The upload did not finish. Try again.' }
  }
  return callVault<{ key: string; item_id: string; message_id: string }>('finish_file', { item_id: prepared.item_id })
}

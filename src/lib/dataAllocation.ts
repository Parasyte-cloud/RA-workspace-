import { supabase } from './supabase'
import type {
  DataOverview,
  DataTierCode,
  HistoryPoint,
  UserRow,
} from './dataAllocationModel'

export * from './dataAllocationModel'

function db() {
  if (!supabase) throw new Error('Workspace service is unavailable.')
  return supabase
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message || 'Data allocation request failed.')
}

export type DataPurchase = {
  id: string
  bytes: number
  label: string
  cost_ngn: number | null
  purchased_on: string
  note: string
  created_at: string
}

export type DataDevice = {
  id: string
  label: string
  msisdn: string
  imei: string
  employee_id: string | null
  note: string
  active: boolean
}

export type MyDataStatus =
  | { has_plan: false }
  | {
      has_plan: true
      status: 'active' | 'suspended'
      tier_label: string
      daily_bytes: number
      allowance_bytes: number
      used_bytes: number
      remaining_bytes: number
      resets_in_seconds: number
      username: string
      has_password: boolean
      pool_exhausted: boolean
    }

export async function loadDataOverview(): Promise<DataOverview> {
  const { data, error } = await db().rpc('admin_data_overview')
  if (error) fail(error)
  return data as DataOverview
}

export async function loadDataUsers(): Promise<UserRow[]> {
  const { data, error } = await db().rpc('admin_data_users')
  if (error) fail(error)
  return (data ?? []) as UserRow[]
}

export async function loadDataHistory(days = 14): Promise<HistoryPoint[]> {
  const { data, error } = await db().rpc('admin_data_history', { p_days: days })
  if (error) fail(error)
  return (data ?? []) as HistoryPoint[]
}

export async function loadDataPurchases(): Promise<DataPurchase[]> {
  const { data, error } = await db()
    .from('data_pool_purchases')
    .select('id,bytes,label,cost_ngn,purchased_on,note,created_at')
    .order('purchased_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) fail(error)
  return (data ?? []) as DataPurchase[]
}

export async function addDataPurchase(input: {
  bytes: number
  label: string
  costNgn: number | null
  note: string
  purchasedOn: string | null
}): Promise<void> {
  const { error } = await db().rpc('admin_data_add_purchase', {
    p_bytes: input.bytes,
    p_label: input.label,
    p_cost_ngn: input.costNgn,
    p_note: input.note,
    p_purchased_on: input.purchasedOn,
  })
  if (error) fail(error)
}

export async function setDataPlan(
  employeeId: string,
  tier: DataTierCode | null,
  status: 'active' | 'suspended' = 'active',
): Promise<void> {
  const { error } = await db().rpc('admin_data_set_plan', {
    p_employee: employeeId,
    p_tier_code: tier,
    p_status: status,
  })
  if (error) fail(error)
}

export async function bulkSetDataPlan(employeeIds: string[], tier: DataTierCode | null): Promise<number> {
  const { data, error } = await db().rpc('admin_data_bulk_set_plan', {
    p_employees: employeeIds,
    p_tier_code: tier,
  })
  if (error) fail(error)
  return Number(data ?? 0)
}

export async function adjustDataToday(employeeId: string, bytes: number, reason: string): Promise<void> {
  const { error } = await db().rpc('admin_data_adjust', {
    p_employee: employeeId,
    p_bytes: bytes,
    p_reason: reason,
  })
  if (error) fail(error)
}

export async function recordManualUsage(employeeId: string, bytes: number, note: string): Promise<void> {
  const { error } = await db().rpc('admin_data_record_usage', {
    p_employee: employeeId,
    p_bytes: bytes,
    p_note: note,
  })
  if (error) fail(error)
}

// Returns the new network password. It is shown once and never stored in readable form.
export async function resetNetworkPassword(employeeId: string): Promise<string> {
  const { data, error } = await db().rpc('admin_data_reset_password', { p_employee: employeeId })
  if (error) fail(error)
  return String(data)
}

export async function setLowPoolAlert(percent: number): Promise<void> {
  const { error } = await db().rpc('admin_data_set_alert', { p_percent: percent })
  if (error) fail(error)
}

export async function loadDataDevices(): Promise<DataDevice[]> {
  const { data, error } = await db()
    .from('data_devices')
    .select('id,label,msisdn,imei,employee_id,note,active')
    .order('label')
  if (error) fail(error)
  return (data ?? []) as DataDevice[]
}

export async function saveDataDevice(input: Omit<DataDevice, 'id'> & { id: string | null }): Promise<void> {
  const { error } = await db().rpc('admin_data_save_device', {
    p_id: input.id,
    p_label: input.label,
    p_msisdn: input.msisdn,
    p_imei: input.imei,
    p_employee: input.employee_id,
    p_note: input.note,
    p_active: input.active,
  })
  if (error) fail(error)
}

export async function deleteDataDevice(id: string): Promise<void> {
  const { error } = await db().rpc('admin_data_delete_device', { p_id: id })
  if (error) fail(error)
}

export async function loadMyDataStatus(): Promise<MyDataStatus> {
  const { data, error } = await db().rpc('my_data_status')
  if (error) fail(error)
  return data as MyDataStatus
}

export async function rotateMyNetworkPassword(): Promise<string> {
  const { data, error } = await db().rpc('my_data_rotate_password')
  if (error) fail(error)
  return String(data)
}

export const DATA_RADIUS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) || ''}/functions/v1/data-radius`

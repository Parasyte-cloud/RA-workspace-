// Pure helpers for Administration > Data Allocation. No network, no Supabase, so they can be
// unit tested. 1 GB = 1024^3 bytes everywhere, matching the database and MTN's own counters.

export const MB = 1024 * 1024
export const GB = 1024 * MB
export const TB = 1024 * GB

export type DataTierCode = 'mb500' | 'gb1' | 'gb2' | 'gb3' | 'gb5'

// Must match public.data_tiers (supabase/migrations/20261018000000_data_allocation.sql).
export const DATA_TIERS: ReadonlyArray<{ code: DataTierCode; label: string; bytes: number }> = [
  { code: 'mb500', label: '500 MB', bytes: 500 * MB },
  { code: 'gb1', label: '1 GB', bytes: 1 * GB },
  { code: 'gb2', label: '2 GB', bytes: 2 * GB },
  { code: 'gb3', label: '3 GB', bytes: 3 * GB },
  { code: 'gb5', label: '5 GB', bytes: 5 * GB },
]

export function tierBytes(code: string | null | undefined): number {
  return DATA_TIERS.find((tier) => tier.code === code)?.bytes ?? 0
}

export function formatBytes(value: number | null | undefined): string {
  const bytes = Number(value ?? 0)
  if (!Number.isFinite(bytes) || bytes === 0) return '0 MB'
  const sign = bytes < 0 ? '-' : ''
  const abs = Math.abs(bytes)
  if (abs >= TB) return `${sign}${trim(abs / TB, 2)} TB`
  if (abs >= GB) return `${sign}${trim(abs / GB, abs >= 100 * GB ? 0 : 2)} GB`
  if (abs >= MB) return `${sign}${trim(abs / MB, abs >= 100 * MB ? 0 : 1)} MB`
  if (abs >= 1024) return `${sign}${trim(abs / 1024, 0)} KB`
  return `${sign}${abs} B`
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export type SizeUnit = 'MB' | 'GB' | 'TB'

// Turns what a person typed into bytes. Returns null for anything that is not a positive number.
export function sizeToBytes(amount: string | number, unit: SizeUnit): number | null {
  const n = typeof amount === 'number' ? amount : Number(String(amount).trim().replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const factor = unit === 'TB' ? TB : unit === 'GB' ? GB : MB
  const bytes = Math.round(n * factor)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null
}

export function usagePercent(used: number, allowance: number): number {
  if (!allowance || allowance <= 0) return used > 0 ? 100 : 0
  return Math.min(100, Math.max(0, Math.round((used / allowance) * 100)))
}

export type UsageLevel = 'none' | 'ok' | 'warn' | 'out'

export function usageLevel(used: number, allowance: number): UsageLevel {
  if (!allowance || allowance <= 0) return 'none'
  const ratio = used / allowance
  if (ratio >= 1) return 'out'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds ?? 0)))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export type DataOverview = {
  purchased_bytes: number
  consumed_bytes: number
  remaining_bytes: number
  daily_commitment_bytes: number
  used_today_bytes: number
  avg_daily_burn_bytes: number
  runway_days_commitment: number | null
  runway_days_actual: number | null
  low_pool_percent: number
  pool_low: boolean
  pool_exhausted: boolean
  users_planned: number
  users_unplanned: number
  users_out_today: number
  gateway_last_seen: string | null
  gateway_active_sessions: number
  resets_in_seconds: number
}

export type GatewayState = 'never' | 'live' | 'quiet'

// "live" means the gateway reported within the last 15 minutes (interim updates arrive every minute).
export function gatewayState(lastSeen: string | null | undefined, now: number = Date.now()): GatewayState {
  if (!lastSeen) return 'never'
  const t = new Date(lastSeen).getTime()
  if (Number.isNaN(t)) return 'never'
  return now - t <= 15 * 60 * 1000 ? 'live' : 'quiet'
}

export type PoolBanner = { tone: 'danger' | 'warning'; text: string } | null

export function poolBanner(o: DataOverview | null): PoolBanner {
  if (!o || o.purchased_bytes <= 0) return null
  if (o.pool_exhausted) {
    return { tone: 'danger', text: 'The data pool is empty. Nobody can connect until you record a new purchase.' }
  }
  if (o.pool_low) {
    const days = o.runway_days_commitment
    return {
      tone: 'warning',
      text: `The pool is below ${o.low_pool_percent}%${days !== null ? `, about ${days} days at today's allocations` : ''}. Buy more data soon.`,
    }
  }
  return null
}

export type UserRow = {
  employee_id: string
  full_name: string
  email: string
  department: string
  tier_code: DataTierCode | null
  plan_status: 'active' | 'suspended' | null
  daily_bytes: number | null
  allowance_bytes: number
  used_bytes: number
  last_seen: string | null
  has_credential: boolean
}

export function filterUsers(rows: UserRow[], query: string, tier: string): UserRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (tier === 'none' && row.tier_code) return false
    if (tier !== 'all' && tier !== 'none' && row.tier_code !== tier) return false
    if (!q) return true
    return `${row.full_name} ${row.email} ${row.department}`.toLowerCase().includes(q)
  })
}

// The pool maths shown next to the allocation table, so the effect of a change is visible
// before it is made: what the commitment would be if these tiers were applied.
export function commitmentFor(rows: UserRow[], overrides: Record<string, DataTierCode | null> = {}): number {
  let total = 0
  for (const row of rows) {
    const tier = row.employee_id in overrides ? overrides[row.employee_id] : row.tier_code
    if (!tier) continue
    const status = row.plan_status ?? 'active'
    if (status === 'suspended') continue
    total += tierBytes(tier)
  }
  return total
}

export type HistoryPoint = { day: string; used_bytes: number; allowance_bytes: number; active_users: number }

export function csvEscape(value: string | number): string {
  const raw = String(value)
  // A text cell that starts with = + - @ is run as a formula by spreadsheets,
  // and these cells hold names, emails and messages people typed. Real numbers
  // (which may be negative) are left alone.
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function usageCsv(rows: UserRow[]): string {
  const head = ['Name', 'Email', 'Department', 'Plan', 'Status', 'Allowance today', 'Used today', 'Remaining today']
  const lines = [head.join(',')]
  for (const row of rows) {
    const remaining = Math.max(0, row.allowance_bytes - row.used_bytes)
    lines.push(
      [
        row.full_name,
        row.email,
        row.department,
        DATA_TIERS.find((t) => t.code === row.tier_code)?.label ?? 'No plan',
        row.plan_status ?? '',
        formatBytes(row.allowance_bytes),
        formatBytes(row.used_bytes),
        formatBytes(remaining),
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return lines.join('\n')
}


// ---- daily delivery to each person's own MTN line --------------------------------------------------

export type TopupStatus = 'pending' | 'delivered' | 'failed' | 'skipped'

export type TierBundle = {
  code: DataTierCode
  label: string
  daily_bytes: number
  provider_variation: string
  price_ngn: number | null
}

export type TopupOverview = {
  enabled: boolean
  cap_ngn: number
  spent_today_ngn: number
  delivered_today: number
  pending_today: number
  failed_today: number
  people_planned: number
  people_ready: number
  people_missing_phone: number
  last_activity: string | null
  tiers: TierBundle[]
  resets_in_seconds: number
}

export type PhoneRow = {
  employee_id: string
  msisdn: string | null
  today_status: TopupStatus | null
  today_message: string | null
}

export type TopupRow = {
  id: string
  day: string
  employee_id: string
  full_name: string
  msisdn_masked: string | null
  tier_code: DataTierCode
  status: TopupStatus
  attempts: number
  amount_ngn: number | null
  message: string
  request_id: string
  updated_at: string
}

export type ProviderBundle = { code: string; name: string; price: number }

export function naira(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'NGN 0'
  return `NGN ${Math.round(value).toLocaleString('en-NG')}`
}

export function deliveryLabel(status: TopupStatus | null | undefined): string {
  switch (status) {
    case 'delivered': return 'Delivered'
    case 'pending': return 'Waiting for MTN'
    case 'failed': return 'Failed'
    case 'skipped': return 'Not sent'
    default: return 'Not yet today'
  }
}

// Things that must be done before delivery can be switched on. Empty means ready.
export function topupBlockers(o: TopupOverview | null, capInput: string): string[] {
  if (!o) return ['Loading']
  const out: string[] = []
  const cap = Number(capInput.replace(/,/g, ''))
  if (!Number.isFinite(cap) || cap <= 0) out.push('Set a daily spending limit in naira')
  if (!o.tiers.some((t) => t.provider_variation && (t.price_ngn ?? 0) > 0)) out.push('Choose the MTN bundle for at least one plan')
  return out
}

// Accepts pasted lines such as "ada@x.com, 0803 123 4567" (comma, tab, semicolon or spaces between them).
export function parsePhoneLines(input: string): { email: string; phone: string }[] {
  const rows: { email: string; phone: string }[] = []
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf('@')
    if (at < 1) continue
    const match = /^([^\s,;\t]+@[^\s,;\t]+)[\s,;\t]+(.+)$/.exec(line)
    if (!match) continue
    rows.push({ email: match[1].trim(), phone: match[2].trim() })
  }
  return rows
}

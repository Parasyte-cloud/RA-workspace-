import { supabase } from './supabase'

export type VendorStatus = 'onboarding' | 'active' | 'on_hold' | 'inactive'

export type VendorCategory =
  | 'fleet_maintenance'
  | 'fuel'
  | 'vehicle_supply'
  | 'insurance'
  | 'airport_venue'
  | 'software'
  | 'professional_services'
  | 'office_supplies'
  | 'other'

export type CommChannel = 'email' | 'phone' | 'whatsapp' | 'meeting' | 'other'
export type CommDirection = 'inbound' | 'outbound'

export type ItemKind = 'order' | 'quote' | 'delivery' | 'invoice' | 'repair' | 'other'
export type ItemStatus =
  | 'requested'
  | 'quoted'
  | 'ordered'
  | 'in_progress'
  | 'delivered'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

export type Vendor = {
  id: string
  name: string
  category: VendorCategory
  status: VendorStatus
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  payment_terms: string | null
  contract_start: string | null
  contract_end: string | null
  document_notes: string | null
  notes: string | null
  owner_id: string | null
  created_at: string
  updated_at: string
}

export type VendorContact = {
  id: string
  vendor_id: string
  name: string
  job_title: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export type VendorCommunication = {
  id: string
  vendor_id: string
  channel: CommChannel
  direction: CommDirection
  subject: string
  summary: string | null
  occurred_at: string
  follow_up_date: string | null
  follow_up_done: boolean
  logged_by: string | null
}

export type VendorItem = {
  id: string
  vendor_id: string
  kind: ItemKind
  title: string
  description: string | null
  reference: string | null
  amount: number | null
  currency: string
  status: ItemStatus
  owner_id: string | null
  due_date: string | null
  completed_at: string | null
}

export type StaffMember = { id: string; full_name: string }

export const CATEGORY_LABELS: Record<VendorCategory, string> = {
  fleet_maintenance: 'Fleet and maintenance',
  fuel: 'Fuel',
  vehicle_supply: 'Vehicle supply',
  insurance: 'Insurance',
  airport_venue: 'Airport and venue partners',
  software: 'Software and services',
  professional_services: 'Professional services',
  office_supplies: 'Office supplies',
  other: 'Other',
}

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  on_hold: 'On hold',
  inactive: 'Inactive',
}

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  order: 'Order',
  quote: 'Quote',
  delivery: 'Delivery',
  invoice: 'Invoice',
  repair: 'Repair',
  other: 'Other',
}

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  requested: 'Requested',
  quoted: 'Quoted',
  ordered: 'Ordered',
  in_progress: 'In progress',
  delivered: 'Delivered',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

export const CHANNEL_LABELS: Record<CommChannel, string> = {
  email: 'Email',
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  meeting: 'Meeting',
  other: 'Other',
}

// An item stops being "open" once it has been delivered, paid or cancelled,
// so it no longer shows up as overdue or as something we are waiting on.
const CLOSED_ITEM_STATUSES: ItemStatus[] = ['delivered', 'paid', 'cancelled']

export function isItemOpen(status: ItemStatus): boolean {
  return !CLOSED_ITEM_STATUSES.includes(status)
}

// Today's date in Lagos as YYYY-MM-DD. Due dates are calendar dates, so they
// are compared as plain strings, which sort correctly in this format.
export function todayLagos(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
  }).format(new Date())
}

export function isItemOverdue(item: Pick<VendorItem, 'due_date' | 'status'>): boolean {
  return Boolean(item.due_date) && isItemOpen(item.status) && item.due_date! < todayLagos()
}

export function isFollowUpDue(
  comm: Pick<VendorCommunication, 'follow_up_date' | 'follow_up_done'>,
): boolean {
  return Boolean(comm.follow_up_date) && !comm.follow_up_done && comm.follow_up_date! <= todayLagos()
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-NG', {
    dateStyle: 'medium',
    timeZone: 'Africa/Lagos',
  })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  })
}

export function formatMoney(amount: number | null, currency: string): string {
  if (amount === null || amount === undefined) return ''
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString('en-NG')}`
  }
}

function db() {
  if (!supabase) throw new Error('The workspace database is not configured.')
  return supabase
}

export function vendorErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : ''

  if (message.includes('vendors_name_unique')) {
    return 'A vendor with this name already exists.'
  }
  if (message.includes('vendor_contacts_one_primary')) {
    return 'This vendor already has a primary contact. Remove the primary flag from the other contact first.'
  }
  if (message.includes('vendors_check')) {
    return 'The contract end date cannot be before the start date.'
  }
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return 'Only Operations, Finance and Admin can change vendor records.'
  }
  if (message.includes('Failed to fetch')) {
    return 'The vendor service could not be reached. Check your connection and try again.'
  }
  return message || 'The vendor action could not be completed.'
}

export async function loadVendors(): Promise<Vendor[]> {
  const { data, error } = await db()
    .from('vendors')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []) as Vendor[]
}

export async function loadAttentionItems(): Promise<{
  items: VendorItem[]
  followUps: VendorCommunication[]
}> {
  const client = db()
  const today = todayLagos()

  const [items, followUps] = await Promise.all([
    client
      .from('vendor_items')
      .select('*')
      .not('status', 'in', '(delivered,paid,cancelled)')
      .not('due_date', 'is', null)
      .lte('due_date', today)
      .order('due_date', { ascending: true }),
    client
      .from('vendor_communications')
      .select('*')
      .eq('follow_up_done', false)
      .not('follow_up_date', 'is', null)
      .lte('follow_up_date', today)
      .order('follow_up_date', { ascending: true }),
  ])

  if (items.error) throw items.error
  if (followUps.error) throw followUps.error

  return {
    items: (items.data || []) as VendorItem[],
    followUps: (followUps.data || []) as VendorCommunication[],
  }
}

export async function loadOpenItemCounts(): Promise<Record<string, number>> {
  const { data, error } = await db()
    .from('vendor_items')
    .select('vendor_id')
    .not('status', 'in', '(delivered,paid,cancelled)')
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of (data || []) as { vendor_id: string }[]) {
    counts[row.vendor_id] = (counts[row.vendor_id] || 0) + 1
  }
  return counts
}

export async function loadVendorDetail(vendorId: string) {
  const client = db()

  const [contacts, comms, items] = await Promise.all([
    client
      .from('vendor_contacts')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('is_primary', { ascending: false })
      .order('name'),
    client
      .from('vendor_communications')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('occurred_at', { ascending: false }),
    client
      .from('vendor_items')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false }),
  ])

  if (contacts.error) throw contacts.error
  if (comms.error) throw comms.error
  if (items.error) throw items.error

  return {
    contacts: (contacts.data || []) as VendorContact[],
    communications: (comms.data || []) as VendorCommunication[],
    items: (items.data || []) as VendorItem[],
  }
}

export async function loadStaff(): Promise<StaffMember[]> {
  const { data, error } = await db()
    .from('employee_profiles')
    .select('id,full_name')
    .eq('active', true)
    .order('full_name')
  if (error) throw error
  return (data || []) as StaffMember[]
}

const clean = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

export type VendorInput = {
  name: string
  category: VendorCategory
  status: VendorStatus
  email: string
  phone: string
  website: string
  address: string
  payment_terms: string
  contract_start: string
  contract_end: string
  document_notes: string
  notes: string
  owner_id: string
}

function vendorPayload(input: VendorInput) {
  return {
    name: input.name.trim(),
    category: input.category,
    status: input.status,
    email: clean(input.email),
    phone: clean(input.phone),
    website: clean(input.website),
    address: clean(input.address),
    payment_terms: clean(input.payment_terms),
    contract_start: clean(input.contract_start),
    contract_end: clean(input.contract_end),
    document_notes: clean(input.document_notes),
    notes: clean(input.notes),
    owner_id: clean(input.owner_id),
  }
}

export async function saveVendor(input: VendorInput, id?: string): Promise<Vendor> {
  const client = db()
  const payload = vendorPayload(input)

  const query = id
    ? client.from('vendors').update(payload).eq('id', id)
    : client.from('vendors').insert(payload)

  const { data, error } = await query.select('*').single()
  if (error) throw error
  return data as Vendor
}

export async function addContact(
  vendorId: string,
  input: { name: string; job_title: string; email: string; phone: string; is_primary: boolean },
) {
  const { error } = await db()
    .from('vendor_contacts')
    .insert({
      vendor_id: vendorId,
      name: input.name.trim(),
      job_title: clean(input.job_title),
      email: clean(input.email),
      phone: clean(input.phone),
      is_primary: input.is_primary,
    })
  if (error) throw error
}

export async function removeContact(id: string) {
  const { error } = await db().from('vendor_contacts').delete().eq('id', id)
  if (error) throw error
}

export async function logCommunication(
  vendorId: string,
  input: {
    channel: CommChannel
    direction: CommDirection
    subject: string
    summary: string
    follow_up_date: string
  },
) {
  const { error } = await db()
    .from('vendor_communications')
    .insert({
      vendor_id: vendorId,
      channel: input.channel,
      direction: input.direction,
      subject: input.subject.trim(),
      summary: clean(input.summary),
      follow_up_date: clean(input.follow_up_date),
    })
  if (error) throw error
}

export async function setFollowUpDone(id: string, done: boolean) {
  const { error } = await db()
    .from('vendor_communications')
    .update({ follow_up_done: done })
    .eq('id', id)
  if (error) throw error
}

export async function addItem(
  vendorId: string,
  input: {
    kind: ItemKind
    title: string
    description: string
    reference: string
    amount: string
    currency: string
    status: ItemStatus
    owner_id: string
    due_date: string
  },
) {
  const amount = input.amount.trim() === '' ? null : Number(input.amount)
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    throw new Error('Enter a valid amount, or leave it blank.')
  }

  const { error } = await db()
    .from('vendor_items')
    .insert({
      vendor_id: vendorId,
      kind: input.kind,
      title: input.title.trim(),
      description: clean(input.description),
      reference: clean(input.reference),
      amount,
      currency: (input.currency.trim() || 'NGN').toUpperCase(),
      status: input.status,
      owner_id: clean(input.owner_id),
      due_date: clean(input.due_date),
    })
  if (error) throw error
}

export async function updateItemStatus(id: string, status: ItemStatus) {
  const { error } = await db().from('vendor_items').update({ status }).eq('id', id)
  if (error) throw error
}

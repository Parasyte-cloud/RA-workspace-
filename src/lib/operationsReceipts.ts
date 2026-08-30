import { supabase } from './supabase'

export type ReceiptType =
  | 'hardcopy_scan'
  | 'softcopy'

export type ReceiptStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'voided'

export type WorkspaceRole =
  | 'operations'
  | 'finance'
  | 'manager'
  | 'admin'
  | string

export type OperationsReceipt = {
  id: string
  receipt_type: ReceiptType
  vendor_name: string
  receipt_date: string
  amount: number
  currency: string
  expense_category: string
  description: string | null
  booking_reference: string | null
  vehicle_reference: string | null
  trip_reference: string | null
  storage_path: string
  original_filename: string
  mime_type: string
  file_size: number
  status: ReceiptStatus
  submitted_by: string
  submitted_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  voided_by: string | null
  voided_at: string | null
  void_reason: string | null
  created_at: string
  updated_at: string
}

export type NewOperationsReceipt = {
  receipt_type: ReceiptType
  vendor_name: string
  receipt_date: string
  amount: number
  currency: string
  expense_category: string
  description?: string
  booking_reference?: string
  vehicle_reference?: string
  trip_reference?: string
  file: File
}

export type ReceiptMetadataUpdate = {
  vendor_name: string
  receipt_date: string
  amount: number
  currency: string
  expense_category: string
  description?: string
  booking_reference?: string
  vehicle_reference?: string
  trip_reference?: string
}

export type ReceiptAuditEvent = {
  id: number
  receipt_id: string
  action: string
  actor_id: string | null
  previous_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

const BUCKET = 'operations-receipts'
const MAX_FILE_SIZE = 15 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function db() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  return supabase
}

function clean(value?: string) {
  const result = value?.trim()
  return result || null
}

function safeFilename(filename: string) {
  const cleaned = filename
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')

  return cleaned || 'receipt'
}

export function receiptErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String(error || '')

  if (
    message.includes('row-level security') ||
    message.includes('permission denied')
  ) {
    return 'You do not have permission to perform this receipt action.'
  }

  if (message.includes('cannot review their own receipt')) {
    return 'You cannot review or approve a receipt that you submitted.'
  }

  if (message.includes('Finalised receipt records cannot be modified')) {
    return 'This receipt has already been finalised and cannot be changed.'
  }

  if (message.includes('Receipt evidence is immutable')) {
    return 'The original receipt file cannot be replaced. Void the receipt and submit a new one instead.'
  }

  if (message.includes('Receipt metadata can only be corrected')) {
    return 'This receipt is already under Finance review and can no longer be edited.'
  }

  if (message.includes('Finance reviewers cannot modify')) {
    return 'Finance can review this receipt but cannot rewrite the submitted expense information.'
  }

  if (message.includes('Failed to fetch')) {
    return 'The receipt service could not be reached. Check your connection and try again.'
  }

  return message || 'The receipt action could not be completed.'
}

export async function loadReceiptWorkspaceRole(): Promise<WorkspaceRole> {
  const client = db()

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser()

  if (authError) throw authError
  if (!user) throw new Error('Your session has expired.')

  const { data, error } = await client
    .from('employee_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error) throw error

  return String(data?.role || '')
}

export async function loadOperationsReceipts() {
  const client = db()

  const { data, error } = await client
    .from('operations_receipts')
    .select('*')
    .order('submitted_at', { ascending: false })

  if (error) throw error

  return (data || []) as OperationsReceipt[]
}

export async function uploadOperationsReceipt(
  input: NewOperationsReceipt,
) {
  const client = db()

  if (!ALLOWED_TYPES.has(input.file.type)) {
    throw new Error(
      'Receipt must be a PDF, JPEG, PNG or WEBP file.',
    )
  }

  if (input.file.size <= 0) {
    throw new Error('The selected receipt file is empty.')
  }

  if (input.file.size > MAX_FILE_SIZE) {
    throw new Error('Receipt files cannot exceed 15 MB.')
  }

  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error('Enter a valid receipt amount.')
  }

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser()

  if (authError) throw authError
  if (!user) throw new Error('Your session has expired.')

  const receiptId = crypto.randomUUID()
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')

  const filename = safeFilename(input.file.name)

  const storagePath = [
    user.id,
    year,
    month,
    receiptId,
    filename,
  ].join('/')

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(storagePath, input.file, {
      upsert: false,
      contentType: input.file.type,
      cacheControl: '3600',
    })

  if (uploadError) throw uploadError

  const { data, error: insertError } = await client
    .from('operations_receipts')
    .insert({
      id: receiptId,
      receipt_type: input.receipt_type,
      vendor_name: input.vendor_name.trim(),
      receipt_date: input.receipt_date,
      amount: input.amount,
      currency: input.currency.trim().toUpperCase(),
      expense_category: input.expense_category.trim(),
      description: clean(input.description),
      booking_reference: clean(input.booking_reference),
      vehicle_reference: clean(input.vehicle_reference),
      trip_reference: clean(input.trip_reference),
      storage_path: storagePath,
      original_filename: input.file.name,
      mime_type: input.file.type,
      file_size: input.file.size,
      submitted_by: user.id,
    })
    .select('*')
    .single()

  if (insertError) {
    await client.storage
      .from(BUCKET)
      .remove([storagePath])

    throw insertError
  }

  return data as OperationsReceipt
}

export async function updateReceiptMetadata(
  receiptId: string,
  input: ReceiptMetadataUpdate,
) {
  const client = db()

  const { data, error } = await client
    .from('operations_receipts')
    .update({
      vendor_name: input.vendor_name.trim(),
      receipt_date: input.receipt_date,
      amount: input.amount,
      currency: input.currency.trim().toUpperCase(),
      expense_category: input.expense_category.trim(),
      description: clean(input.description),
      booking_reference: clean(input.booking_reference),
      vehicle_reference: clean(input.vehicle_reference),
      trip_reference: clean(input.trip_reference),
    })
    .eq('id', receiptId)
    .select('*')
    .single()

  if (error) throw error

  return data as OperationsReceipt
}

export async function transitionReceipt(
  receiptId: string,
  status: ReceiptStatus,
  options?: {
    reviewNote?: string
    voidReason?: string
  },
) {
  const client = db()

  const payload: Record<string, string | null> = {
    status,
  }

  if (options?.reviewNote !== undefined) {
    payload.review_note = clean(options.reviewNote)
  }

  if (options?.voidReason !== undefined) {
    payload.void_reason = clean(options.voidReason)
  }

  const { data, error } = await client
    .from('operations_receipts')
    .update(payload)
    .eq('id', receiptId)
    .select('*')
    .single()

  if (error) throw error

  return data as OperationsReceipt
}

export async function createReceiptSignedUrl(
  receipt: OperationsReceipt,
) {
  const client = db()

  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(
      receipt.storage_path,
      10 * 60,
      {
        download: receipt.original_filename,
      },
    )

  if (error) throw error
  if (!data?.signedUrl) {
    throw new Error('Could not create a secure receipt link.')
  }

  return data.signedUrl
}

export async function loadReceiptAudit(
  receiptId: string,
) {
  const client = db()

  const { data, error } = await client
    .from('operations_receipt_audit')
    .select('*')
    .eq('receipt_id', receiptId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []) as ReceiptAuditEvent[]
}

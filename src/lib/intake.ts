import { supabase } from './supabase'

export const INTAKE_STATUSES = [
  'new',
  'in_progress',
  'followed_up',
  'resolved',
  'closed',
] as const

export type IntakeStatus =
  (typeof INTAKE_STATUSES)[number]

export const INTAKE_STATUS_LABELS:
  Record<IntakeStatus, string> = {
    new: 'New',
    in_progress: 'In Progress',
    followed_up: 'Followed Up',
    resolved: 'Resolved',
    closed: 'Closed',
  }

export type IntakeVisibility =
  | 'internal'
  | 'public'

export type IntakeLifecycleStatus =
  | 'draft'
  | 'published'
  | 'disabled'

export type IntakeFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'integer'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'date'
  | 'url'

export type IntakeFieldDefinition = {
  key: string
  label: string
  type: IntakeFieldType
  required: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  options?: string[]
  placeholder?: string
  helpText?: string
}

export type IntakeFieldSchemaDocument = {
  fields: IntakeFieldDefinition[]
}

export type IntakeFormDefinition = {
  slug: string
  title: string
  description: string | null
  category: {
    slug: string
    title: string
  }
  version: number
  fields: IntakeFieldDefinition[]
}

export type IntakeSubmissionReceipt = {
  id: string
  reference: string
  status: IntakeStatus
  submittedAt: string
}

export type IntakeCategory = {
  id: string
  slug: string
  title: string
  description: string | null
  default_workstation: string
  active: boolean
  created_at?: string
  updated_at?: string
}

export type IntakeForm = {
  id: string
  category_id: string
  slug: string
  internal_name: string
  public_slug: string | null
  destination_workstation: string
  default_assignee_id: string | null
  visibility: IntakeVisibility
  lifecycle_status: IntakeLifecycleStatus
  published_version_id: string | null
  created_at?: string
  updated_at?: string
}

export type IntakeFormVersion = {
  id: string
  form_id: string
  version_number: number
  title: string
  description: string | null
  field_schema: IntakeFieldSchemaDocument
  published_at: string | null
  created_at?: string
}

export type IntakeSubmission = {
  id: string
  form_id: string
  form_version_id: string
  category_id: string
  form_title_snapshot: string
  category_title_snapshot: string
  payload: Record<string, unknown>
  source: string
  source_reference: string | null
  destination_workstation: string
  assigned_employee_id: string | null
  submitted_by_user_id: string | null
  whatsapp_conversation_id: string | null
  status: IntakeStatus
  submitted_at: string
  updated_at: string
  followed_up_at: string | null
  resolved_at: string | null
  closed_at: string | null
  search_text: string
}

export type IntakeSubmissionEvent = {
  id: string
  submission_id: string
  event_type: string
  actor_user_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type IntakeAssignmentCandidate = {
  employee_id: string
  full_name: string
  job_title: string | null
  department: string | null
  employee_role: string
}

export type IntakeSubmissionFilters = {
  categoryId?: string
  workstation?: string
  statuses?: IntakeStatus[]
  assigneeId?: string | null
  formId?: string
  query?: string
  limit?: number
}

export class IntakeRequestError extends Error {
  status: number
  fields: string[]
  requestId: string | null

  constructor(
    message: string,
    status: number,
    fields: string[] = [],
    requestId: string | null = null,
  ) {
    super(message)
    this.name = 'IntakeRequestError'
    this.status = status
    this.fields = fields
    this.requestId = requestId
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  return supabase
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

function normalizeLimit(
  value: number | undefined,
) {
  if (!Number.isInteger(value)) {
    return 200
  }

  return Math.min(
    500,
    Math.max(1, Number(value)),
  )
}

export function normalizeIntakeSlug(
  value: string,
) {
  const slug =
    String(value || '')
      .trim()
      .toLowerCase()

  if (
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
  ) {
    throw new Error(
      'A valid intake form slug is required.',
    )
  }

  return slug
}

export function intakeStatusLabel(
  status: IntakeStatus,
) {
  return INTAKE_STATUS_LABELS[status]
}

export function nextIntakeVersionNumber(
  versions: IntakeFormVersion[],
) {
  return (
    versions.reduce(
      (highest, version) =>
        Math.max(
          highest,
          Number(version.version_number) || 0,
        ),
      0,
    ) + 1
  )
}

function intakeEndpoint() {
  const base =
    String(
      import.meta.env.VITE_SUPABASE_URL || '',
    )
      .trim()
      .replace(/\/+$/, '')

  if (!base) {
    throw new Error(
      'Supabase is not configured.',
    )
  }

  return `${base}/functions/v1/intake`
}

function requestHeaders(
  hasBody: boolean,
  accessToken?: string,
) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  const anonKey =
    String(
      import.meta.env
        .VITE_SUPABASE_ANON_KEY || '',
    ).trim()

  if (anonKey) {
    headers.apikey = anonKey
  }

  if (hasBody) {
    headers['Content-Type'] =
      'application/json'
  }

  if (accessToken) {
    headers.Authorization =
      `Bearer ${accessToken}`
  }

  return headers
}

async function authenticatedHeaders(
  hasBody: boolean,
) {
  const client = requireSupabase()

  const {
    data: { session },
    error,
  } = await client.auth.getSession()

  if (
    error ||
    !session?.access_token
  ) {
    throw new Error(
      'Your RideArrivo Workspace session has expired.',
    )
  }

  return requestHeaders(
    hasBody,
    session.access_token,
  )
}

async function parseIntakeResponse<T>(
  response: Response,
): Promise<T> {
  const text =
    await response.text()

  let body: unknown = null

  try {
    body =
      text
        ? JSON.parse(text)
        : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const record =
      isRecord(body)
        ? body
        : {}

    const message =
      typeof record.error === 'string'
        ? record.error
        : `Intake request failed (${response.status}).`

    const fields =
      Array.isArray(record.fields)
        ? record.fields.map(
            field => String(field),
          )
        : []

    throw new IntakeRequestError(
      message,
      response.status,
      fields,
      response.headers.get(
        'X-Request-ID',
      ),
    )
  }

  return body as T
}

async function intakeRequest<T>(
  params: URLSearchParams,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    authenticated?: boolean
  } = {},
) {
  const url =
    new URL(
      intakeEndpoint(),
    )

  params.forEach(
    (value, key) =>
      url.searchParams.set(
        key,
        value,
      ),
  )

  const method =
    options.method || 'GET'

  const hasBody =
    options.body !== undefined

  const headers =
    options.authenticated
      ? await authenticatedHeaders(
          hasBody,
        )
      : requestHeaders(
          hasBody,
        )

  const response =
    await fetch(
      url.toString(),
      {
        method,
        headers,
        ...(
          hasBody
            ? {
                body:
                  JSON.stringify(
                    options.body,
                  ),
              }
            : {}
        ),
      },
    )

  return parseIntakeResponse<T>(
    response,
  )
}

export async function getPublicIntakeForm(
  slug: string,
) {
  const params =
    new URLSearchParams()

  params.set(
    'slug',
    normalizeIntakeSlug(slug),
  )

  const response =
    await intakeRequest<{
      form: IntakeFormDefinition
    }>(params)

  return response.form
}

export async function getInternalIntakeForm(
  slug: string,
) {
  const params =
    new URLSearchParams()

  params.set(
    'scope',
    'internal',
  )

  params.set(
    'slug',
    normalizeIntakeSlug(slug),
  )

  const response =
    await intakeRequest<{
      form: IntakeFormDefinition
    }>(
      params,
      {
        authenticated: true,
      },
    )

  return response.form
}

export async function submitPublicIntakeForm(
  input: {
    slug: string
    payload: Record<string, unknown>
    website?: string
  },
) {
  const response =
    await intakeRequest<{
      ok: true
      submission: IntakeSubmissionReceipt
    }>(
      new URLSearchParams(),
      {
        method: 'POST',
        body: {
          slug:
            normalizeIntakeSlug(
              input.slug,
            ),
          payload: input.payload,
          website:
            input.website || '',
        },
      },
    )

  return response.submission
}

export async function submitInternalIntakeForm(
  input: {
    slug: string
    payload: Record<string, unknown>
    whatsappConversationId?:
      string | null
  },
) {
  const params =
    new URLSearchParams()

  params.set(
    'scope',
    'internal',
  )

  const body:
    Record<string, unknown> = {
      slug:
        normalizeIntakeSlug(
          input.slug,
        ),
      payload:
        input.payload,
    }

  if (
    input.whatsappConversationId
  ) {
    body.whatsappConversationId =
      input.whatsappConversationId
  }

  const response =
    await intakeRequest<{
      ok: true
      submission: IntakeSubmissionReceipt
    }>(
      params,
      {
        method: 'POST',
        body,
        authenticated: true,
      },
    )

  return response.submission
}

export async function listIntakeCategories(
  options: {
    includeInactive?: boolean
  } = {},
) {
  const client =
    requireSupabase()

  let query =
    client
      .from('intake_categories')
      .select('*')
      .order(
        'title',
        {
          ascending: true,
        },
      )

  if (
    !options.includeInactive
  ) {
    query =
      query.eq(
        'active',
        true,
      )
  }

  const {
    data,
    error,
  } = await query

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake categories.',
    )
  }

  return (
    data || []
  ) as IntakeCategory[]
}

export async function listIntakeForms(
  filters: {
    categoryId?: string
    visibility?: IntakeVisibility
    lifecycleStatus?:
      IntakeLifecycleStatus
    workstation?: string
  } = {},
) {
  const client =
    requireSupabase()

  let query =
    client
      .from('intake_forms')
      .select('*')
      .order(
        'updated_at',
        {
          ascending: false,
        },
      )

  if (filters.categoryId) {
    query =
      query.eq(
        'category_id',
        filters.categoryId,
      )
  }

  if (filters.visibility) {
    query =
      query.eq(
        'visibility',
        filters.visibility,
      )
  }

  if (filters.lifecycleStatus) {
    query =
      query.eq(
        'lifecycle_status',
        filters.lifecycleStatus,
      )
  }

  if (filters.workstation) {
    query =
      query.eq(
        'destination_workstation',
        filters.workstation,
      )
  }

  const {
    data,
    error,
  } = await query

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake forms.',
    )
  }

  return (
    data || []
  ) as IntakeForm[]
}

export async function listIntakeFormVersions(
  formId: string,
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_form_versions',
      )
      .select('*')
      .eq(
        'form_id',
        formId,
      )
      .order(
        'version_number',
        {
          ascending: false,
        },
      )

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake form versions.',
    )
  }

  return (
    data || []
  ) as IntakeFormVersion[]
}

export async function listIntakeSubmissions(
  filters:
    IntakeSubmissionFilters = {},
) {
  const client =
    requireSupabase()

  let query =
    client
      .from(
        'intake_submissions',
      )
      .select('*')
      .order(
        'submitted_at',
        {
          ascending: false,
        },
      )
      .limit(
        normalizeLimit(
          filters.limit,
        ),
      )

  if (filters.categoryId) {
    query =
      query.eq(
        'category_id',
        filters.categoryId,
      )
  }

  if (filters.workstation) {
    query =
      query.eq(
        'destination_workstation',
        filters.workstation,
      )
  }

  if (filters.formId) {
    query =
      query.eq(
        'form_id',
        filters.formId,
      )
  }

  if (
    filters.statuses?.length
  ) {
    query =
      query.in(
        'status',
        filters.statuses,
      )
  }

  if (
    filters.assigneeId === null
  ) {
    query =
      query.is(
        'assigned_employee_id',
        null,
      )
  } else if (
    filters.assigneeId
  ) {
    query =
      query.eq(
        'assigned_employee_id',
        filters.assigneeId,
      )
  }

  if (
    filters.query?.trim()
  ) {
    query =
      query.ilike(
        'search_text',
        `%${filters.query.trim()}%`,
      )
  }

  const {
    data,
    error,
  } = await query

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake submissions.',
    )
  }

  return (
    data || []
  ) as IntakeSubmission[]
}

export async function getIntakeSubmission(
  submissionId: string,
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_submissions',
      )
      .select('*')
      .eq(
        'id',
        submissionId,
      )
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake submission.',
    )
  }

  return (
    data || null
  ) as IntakeSubmission | null
}

export async function listIntakeSubmissionEvents(
  submissionId: string,
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_submission_events',
      )
      .select('*')
      .eq(
        'submission_id',
        submissionId,
      )
      .order(
        'created_at',
        {
          ascending: true,
        },
      )

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake submission history.',
    )
  }

  return (
    data || []
  ) as IntakeSubmissionEvent[]
}

export async function updateIntakeSubmissionStatus(
  submissionId: string,
  status: IntakeStatus,
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_submissions',
      )
      .update({
        status,
      })
      .eq(
        'id',
        submissionId,
      )
      .select('*')
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to update intake submission status.',
    )
  }

  if (!data) {
    throw new Error(
      'The submission was not updated or is no longer accessible.',
    )
  }

  return data as IntakeSubmission
}

export async function listIntakeAssignmentCandidates(
  workstation: string,
) {
  const normalizedWorkstation =
    workstation
      .trim()
      .toLowerCase()

  if (!normalizedWorkstation) {
    throw new Error(
      'Destination workstation is required.',
    )
  }

  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client.rpc(
      'list_intake_assignment_candidates',
      {
        p_workstation:
          normalizedWorkstation,
      },
    )

  if (error) {
    throw new Error(
      error.message ||
      'Unable to load intake assignment candidates.',
    )
  }

  return (
    data || []
  ) as IntakeAssignmentCandidate[]
}

export async function reassignIntakeSubmission(
  submissionId: string,
  employeeId: string | null,
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_submissions',
      )
      .update({
        assigned_employee_id:
          employeeId,
      })
      .eq(
        'id',
        submissionId,
      )
      .select('*')
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to reassign intake submission.',
    )
  }

  if (!data) {
    throw new Error(
      'The submission was not reassigned or is no longer accessible.',
    )
  }

  return data as IntakeSubmission
}

export async function createIntakeCategory(
  input: {
    slug: string
    title: string
    description?: string | null
    defaultWorkstation: string
    active?: boolean
  },
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_categories',
      )
      .insert({
        slug:
          normalizeIntakeSlug(
            input.slug,
          ),
        title:
          input.title.trim(),
        description:
          input.description
            ?.trim() || null,
        default_workstation:
          input.defaultWorkstation
            .trim(),
        active:
          input.active !== false,
      })
      .select('*')
      .single()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to create intake category.',
    )
  }

  return data as IntakeCategory
}

export async function createIntakeForm(
  input: {
    categoryId: string
    slug: string
    internalName: string
    publicSlug?: string | null
    destinationWorkstation: string
    defaultAssigneeId?:
      string | null
    visibility: IntakeVisibility
  },
) {
  const client =
    requireSupabase()

  const publicSlug =
    input.visibility === 'public'
      ? normalizeIntakeSlug(
          String(
            input.publicSlug ||
            input.slug,
          ),
        )
      : null

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_forms',
      )
      .insert({
        category_id:
          input.categoryId,
        slug:
          normalizeIntakeSlug(
            input.slug,
          ),
        internal_name:
          input.internalName
            .trim(),
        public_slug:
          publicSlug,
        destination_workstation:
          input.destinationWorkstation
            .trim(),
        default_assignee_id:
          input.defaultAssigneeId ||
          null,
        visibility:
          input.visibility,
        lifecycle_status:
          'draft',
      })
      .select('*')
      .single()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to create intake form.',
    )
  }

  return data as IntakeForm
}

export async function createIntakeFormVersion(
  input: {
    formId: string
    versionNumber: number
    title: string
    description?: string | null
    fieldSchema:
      IntakeFieldSchemaDocument
  },
) {
  if (
    !Number.isInteger(
      input.versionNumber,
    ) ||
    input.versionNumber < 1
  ) {
    throw new Error(
      'Intake form version must be a positive integer.',
    )
  }

  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_form_versions',
      )
      .insert({
        form_id:
          input.formId,
        version_number:
          input.versionNumber,
        title:
          input.title.trim(),
        description:
          input.description
            ?.trim() || null,
        field_schema:
          input.fieldSchema,
      })
      .select('*')
      .single()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to create intake form version.',
    )
  }

  return data as IntakeFormVersion
}

export async function publishIntakeFormVersion(
  formId: string,
  versionId: string,
) {
  const client =
    requireSupabase()

  const {
    error,
  } =
    await client.rpc(
      'publish_intake_form_version',
      {
        p_form_id:
          formId,
        p_version_id:
          versionId,
      },
    )

  if (error) {
    throw new Error(
      error.message ||
      'Unable to publish intake form version.',
    )
  }
}

export async function disableIntakeForm(
  formId: string,
) {
  const client =
    requireSupabase()

  const {
    data,
    error,
  } =
    await client
      .from(
        'intake_forms',
      )
      .update({
        lifecycle_status:
          'disabled',
        published_version_id:
          null,
      })
      .eq(
        'id',
        formId,
      )
      .select('*')
      .single()

  if (error) {
    throw new Error(
      error.message ||
      'Unable to disable intake form.',
    )
  }

  return data as IntakeForm
}

export function subscribeToIntakeWorkstation(
  workstation: string,
  onChange: () => void | Promise<void>,
) {
  const client =
    requireSupabase()

  const route =
    String(workstation || '')
      .trim()
      .toLowerCase()

  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(
      route,
    )
  ) {
    throw new Error(
      'A valid workstation route is required.',
    )
  }

  const channelName = [
    'intake-workstation',
    route,
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join('-')

  const channel =
    client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table:
            'intake_submissions',
          filter:
            `destination_workstation=eq.${route}`,
        },
        () => {
          void onChange()
        },
      )
      .subscribe()

  return () => {
    void client.removeChannel(
      channel,
    )
  }
}

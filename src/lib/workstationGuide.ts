import { supabase } from './supabase'

export const WORKSTATION_GUIDE_BUCKET = 'workstation-guides'

export const DEFAULT_WORKSTATION_GUIDE_SLUG = 'canonical'

export const WORKSTATION_GUIDE_VERSION = '3.0'

export type WorkstationGuideTheme = 'light' | 'dark'

// The theme the workspace is showing right now (html[data-ra-theme]).
export function currentGuideTheme(): WorkstationGuideTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.raTheme === 'dark' ? 'dark' : 'light'
}

export function workstationGuidePath(
  slug: string = DEFAULT_WORKSTATION_GUIDE_SLUG,
  theme: WorkstationGuideTheme = 'light'
): string {
  return theme === 'dark' ? `${slug}/readme-dark.pdf` : `${slug}/readme.pdf`
}

/**
 * Downloads a guide with the signed-in user's session and returns a blob: URL
 * for an in-workspace iframe. The bucket only accepts PDFs, but the Blob type is
 * set explicitly so the browser never has to guess what it is showing.
 * The caller must URL.revokeObjectURL() the result when the viewer closes.
 */
export async function loadWorkstationGuideBlobUrl(
  slug: string = DEFAULT_WORKSTATION_GUIDE_SLUG,
  theme: WorkstationGuideTheme = currentGuideTheme()
): Promise<string> {
  const client = supabase

  if (!client) {
    throw new Error('Workspace document service is unavailable.')
  }

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser()

  if (authError) {
    throw authError
  }

  if (!user) {
    throw new Error('Your workspace session has expired.')
  }

  const bucket = client.storage.from(WORKSTATION_GUIDE_BUCKET)
  let { data, error } = await bucket.download(workstationGuidePath(slug, theme))

  // The dark file may not be uploaded yet: fall back to the light one rather than fail.
  if (error && theme === 'dark') {
    ;({ data, error } = await bucket.download(workstationGuidePath(slug, 'light')))
  }

  if (error) {
    throw error
  }

  if (!data || data.size === 0) {
    throw new Error('The workstation guide is currently unavailable.')
  }

  return URL.createObjectURL(
    new Blob([data], { type: 'application/pdf' })
  )
}

// Which README a person sees on their dashboard: their own workstation's.
// Order matches how the workspace decides which workstation is theirs: an active
// primary assignment first, then their role. Anyone with neither gets the general
// workspace guide. Keep the role table in step with sectionAccess in App.tsx
// (scripts/workstation-guide-access.test.mjs fails if they drift apart).
const WORKSTATION_GUIDE_LABELS: Record<string, string> = {
  support: 'Customer Support',
  operations: 'Mobility Operations',
  people: 'People Operations',
  engineering: 'Engineering',
  finance: 'Finance & Accounting',
  marketing: 'Marketing',
  partnerships: 'Partnerships',
  legal: 'Legal & Compliance',
  executive: 'Executive',
  administration: 'Administration',
}

const ROLE_TO_WORKSTATION: Record<string, string> = {
  support: 'support',
  operations: 'operations',
  hr: 'people',
  engineer: 'engineering',
  cto: 'engineering',
  finance: 'finance',
  marketing: 'marketing',
  partnerships: 'partnerships',
  legal: 'legal',
  manager: 'executive',
  admin: 'administration',
}

export function guideForUser(
  role: string,
  assignments: { workstation: string; is_primary: boolean; active: boolean }[] = []
): { slug: string; label: string } {
  const primary = assignments.find((item) => item.active && item.is_primary)
  const workstation =
    (primary && WORKSTATION_GUIDE_LABELS[primary.workstation] ? primary.workstation : '') ||
    ROLE_TO_WORKSTATION[String(role || '').toLowerCase()] ||
    ''
  if (!workstation) {
    return { slug: DEFAULT_WORKSTATION_GUIDE_SLUG, label: 'Your Workspace' }
  }
  return { slug: workstation, label: WORKSTATION_GUIDE_LABELS[workstation] }
}

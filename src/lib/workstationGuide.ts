import { supabase } from './supabase'

export const WORKSTATION_GUIDE_BUCKET = 'workstation-guides'

export const DEFAULT_WORKSTATION_GUIDE_SLUG = 'canonical'

export const WORKSTATION_GUIDE_VERSION = '3.0'

export function workstationGuidePath(
  slug: string = DEFAULT_WORKSTATION_GUIDE_SLUG
): string {
  return `${slug}/readme.pdf`
}

/**
 * Downloads a guide with the signed-in user's session and returns a blob: URL
 * for an in-workspace iframe. The bucket only accepts PDFs, but the Blob type is
 * set explicitly so the browser never has to guess what it is showing.
 * The caller must URL.revokeObjectURL() the result when the viewer closes.
 */
export async function loadWorkstationGuideBlobUrl(
  slug: string = DEFAULT_WORKSTATION_GUIDE_SLUG
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

  const { data, error } = await client.storage
    .from(WORKSTATION_GUIDE_BUCKET)
    .download(workstationGuidePath(slug))

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

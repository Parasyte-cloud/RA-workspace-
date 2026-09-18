import { supabase } from './supabase'

export const WORKSTATION_GUIDE_BUCKET = 'workstation-guides'

export const DEFAULT_WORKSTATION_GUIDE_SLUG = 'canonical'

export const WORKSTATION_GUIDE_VERSION = '2.0'

export function workstationGuidePath(
  slug: string = DEFAULT_WORKSTATION_GUIDE_SLUG
): string {
  return `${slug}/readme.pdf`
}

const SIGNED_URL_SECONDS = 5 * 60

export async function createWorkstationGuideUrl(
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
    .createSignedUrl(
      workstationGuidePath(slug),
      SIGNED_URL_SECONDS
    )

  if (error) {
    throw error
  }

  if (!data?.signedUrl) {
    throw new Error('The workstation guide is currently unavailable.')
  }

  return data.signedUrl
}

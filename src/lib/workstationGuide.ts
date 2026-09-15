import { supabase } from './supabase'

export const WORKSTATION_GUIDE = {
  bucket: 'workstation-guides',
  path: 'canonical/readme.pdf',
  label: 'README - How to Use This Workstation',
  version: '1.0',
} as const

const SIGNED_URL_SECONDS = 5 * 60

export async function createWorkstationGuideUrl(): Promise<string> {
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
    .from(WORKSTATION_GUIDE.bucket)
    .createSignedUrl(
      WORKSTATION_GUIDE.path,
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

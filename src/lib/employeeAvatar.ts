import { supabase } from './supabase'

const BUCKET = 'employee-headshots'
const SIGNED_URL_SECONDS = 15 * 60

export async function resolveEmployeeAvatarUrl(
  avatarPath?: string | null
): Promise<string | null> {
  const path =
    typeof avatarPath === 'string'
      ? avatarPath.trim()
      : ''

  if (!supabase || !path) {
    return null
  }

  const {
    data,
    error
  } =
    await supabase.storage
      .from(BUCKET)
      .createSignedUrl(
        path,
        SIGNED_URL_SECONDS
      )

  if (error) {
    console.warn(
      'Unable to resolve employee avatar:',
      error.message
    )

    return null
  }

  return data?.signedUrl || null
}

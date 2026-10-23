import { supabase } from './supabase'

const QUARANTINE_BUCKET = 'collaboration-quarantine'

export type GovernedUploadResult = {
  fileId: string
  versionId: string
  mime: string
  sha256: string
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export async function uploadGovernedChatFile(
  conversationId: string,
  file: File,
  classification: 'internal' | 'confidential' | 'restricted' = 'internal',
): Promise<GovernedUploadResult> {
  const db = client()
  const { data: signed, error: signError } = await db.functions.invoke(
    'collaboration-file-ingest',
    {
      body: {
        action: 'sign',
        scope_kind: 'conversation',
        scope_id: conversationId,
        name: file.name,
        mime: file.type || null,
        bytes: file.size,
        classification,
      },
    },
  )

  if (signError || !signed?.path || !signed?.token || !signed?.file_id || !signed?.version_id) {
    throw new Error(signError?.message || signed?.error || 'Unable to prepare secure file upload.')
  }

  const { error: uploadError } = await db.storage
    .from(QUARANTINE_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: 'application/octet-stream',
      cacheControl: '0',
    })

  if (uploadError) throw new Error(uploadError.message || 'Unable to upload file for security scanning.')

  const { data: finalized, error: finalizeError } = await db.functions.invoke(
    'collaboration-file-ingest',
    {
      body: {
        action: 'finalize',
        file_id: signed.file_id,
        version_id: signed.version_id,
      },
    },
  )

  if (finalizeError || !finalized?.ok) {
    throw new Error(finalizeError?.message || finalized?.error || 'File security verification failed.')
  }

  return {
    fileId: signed.file_id,
    versionId: signed.version_id,
    mime: finalized.mime,
    sha256: finalized.sha256,
  }
}


export async function copyGovernedChatAttachment(
  sourceMessageId: string,
  targetConversationId: string,
): Promise<{ path: string; fileId: string }> {
  const { data, error } = await client().functions.invoke(
    'collaboration-file-ingest',
    {
      body: {
        action: 'copy',
        source_message_id: sourceMessageId,
        target_conversation_id: targetConversationId,
      },
    },
  )
  if (error || !data?.path || !data?.file_id) {
    throw new Error(error?.message || data?.error || 'The file could not be copied securely.')
  }
  return { path: data.path, fileId: data.file_id }
}

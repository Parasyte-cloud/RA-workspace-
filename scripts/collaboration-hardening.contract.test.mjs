import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migration=fs.readFileSync('supabase/migrations/20261022050000_collaboration_hardening.sql','utf8')
const ingest=fs.readFileSync('supabase/functions/collaboration-file-ingest/index.ts','utf8')
const chat=fs.readFileSync('src/chat/ChatShell.tsx','utf8')
const chatApi=fs.readFileSync('src/chat/api/chatApi.ts','utf8')
const calendarApi=fs.readFileSync('src/lib/room7CalendarApi.ts','utf8')
const search=fs.readFileSync('supabase/functions/workspace-search/index.ts','utf8')
const fileOutbox=fs.readFileSync('src/lib/chatFileOutbox.ts','utf8')

const requiredTables=[
  'collaboration_files','collaboration_file_versions','collaboration_file_links',
  'collaboration_file_access_events','collaboration_resource_links','collaboration_activity_events',
]

test('governed collaboration file domain is present and RLS protected',()=>{
  for(const table of requiredTables){
    assert.match(migration,new RegExp(`create table if not exists public\\.${table}`))
    assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`))
  }
})

test('browser cannot upload directly into final chat attachment storage',()=>{
  assert.match(migration,/drop policy if exists "chat attachments upload" on storage\.objects/)
  assert.doesNotMatch(chat,/\.from\(ATTACH_BUCKET\)\.(upload|copy)\(/)
  assert.match(chat,/uploadGovernedChatFile\(conversationId,file\)/)
  assert.match(chat,/copyGovernedChatAttachment\(source\.id,conversationId\)/)
  assert.match(ingest,/body\.action==="copy"/)
  assert.match(ingest,/const scanResult=await scan\(bytes,name,verified\)/)
  assert.match(migration,/bind_social_message_collaboration_file/)
})

test('file ingest verifies bytes, checksum and malware verdict before promotion',()=>{
  assert.match(ingest,/function sniff\(/)
  assert.match(ingest,/crypto\.subtle\.digest\("SHA-256"/)
  assert.match(ingest,/COLLAB_FILE_SCAN_URL/)
  assert.match(ingest,/scan_status:\s*"clean"/)
  assert.match(ingest,/collaboration-quarantine/)
})

test('attachment messages use one authorized RPC',()=>{
  assert.match(chatApi,/send_chat_attachment_message/)
  assert.match(migration,/create or replace function public\.send_chat_attachment_message/)
  assert.match(migration,/public\.can_write_to_conversation\(p_conversation_id\)/)
  assert.match(migration,/scan_status='clean'/)
})

test('attachment preview bearer URLs are short lived',()=>{
  assert.match(chat,/const SIGNED_SECONDS=600/)
})

test('Room7 calendar writes are RPC-only and bound to canonical meetings',()=>{
  assert.match(migration,/room7_calendar_events_meeting_fk/)
  assert.match(migration,/join URL must be the canonical Room7 URL/i)
  assert.match(migration,/revoke insert,update on public\.room7_calendar_events from authenticated/)
  assert.match(calendarApi,/\.rpc\(\s*'save_room7_calendar_event'/)
  assert.match(calendarApi,/\.rpc\(\s*'cancel_room7_calendar_event'/)
  assert.doesNotMatch(calendarApi,/\.from\(\s*'room7_calendar_events'/)
})

test('collaboration audit records are append only',()=>{
  assert.match(migration,/collaboration_file_access_append_only/)
  assert.match(migration,/collaboration_activity_append_only/)
  assert.match(migration,/room7_calendar_audit_append_only/)
})

test('unified search includes governed collaboration artifacts under caller RLS',()=>{
  for(const table of ['collaboration_files','workspace_notes','collaboration_messages','workspace_room_messages','workspace_room_transcript_segments']){
    assert.ok(search.includes(`table: "${table}"`),`${table} missing from unified search`)
  }
  assert.doesNotMatch(search,/SUPABASE_SERVICE_ROLE_KEY/)
})


test('failed file sends survive reload in IndexedDB',()=>{
  assert.match(fileOutbox,/indexedDB\.open/)
  assert.match(fileOutbox,/userConversation/)
  assert.match(chat,/savePendingFileRetry/)
  assert.match(chat,/listPendingFileRetries/)
  assert.match(chat,/loadPendingFileRetry/)
  assert.match(chat,/removePendingFileRetry/)
})

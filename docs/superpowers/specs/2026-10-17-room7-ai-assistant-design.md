# R7 AI Assistant: product and system design (revision 2)

**Date:** 2026-10-17
**Product:** RideArrivo ROOM 7 / RA-Workspace
**Status:** Phases 0 and 1 built; later phases designed
**Replaces:** the first draft of this spec (same date)

## What changed from the first draft

The first draft was sound on product decisions. This revision keeps them and fixes the places where the design did not yet match the real system or would have failed in practice.

| # | Gap in the first draft | Resolution in this revision |
|---|---|---|
| 1 | Sessions were keyed to a ROOM 7 room, but `workspace_rooms.cloudflare_meeting_id` is required and unique. A physical meeting has no video room. | AI sessions have their own table with a nullable `room_id`. Physical meetings never touch `workspace_rooms`. Online and hybrid link to a room later. |
| 2 | "Live transcription" assumed a streaming socket from the browser, which needs a provider key in the browser. | The browser cuts short self-contained audio slices and posts them to a function. The key stays on the server. Latency is about 10 seconds, which is fine for a rough live view. |
| 3 | Chunked recording said chunks join into one file, without saying how. MediaRecorder chunks are not independently playable. | One continuous recorder emits ordered chunks (10 s). Their byte concatenation is the full recording. A server step joins them, checks each chunk's SHA-256 and size, and hands the result to the provider by signed URL. |
| 4 | Live slices and the durable recording were one concept. | Two separate paths. The durable chunk stream is the source of truth. Live slices are disposable and never stored. A failed live slice never affects the recording. |
| 5 | Retention said "delete after successful finalization" without a mechanism. | The database sets `delete_after` itself when a session reaches `ready`, from the host's retention choice. A cron function deletes, confirms storage is empty, and only then records the deletion. Failed sessions keep audio for 14 days, then are cleaned up. |
| 6 | Access said "active employees" but gave no predicate. | `can_read_room_ai_session` (host or listed attendee, and `employee_profiles.active`) and `can_manage_room_ai_session` (host only). No admin branch. Deactivated staff lose access immediately. |
| 7 | The state machine was a diagram only. | A database trigger enforces allowed transitions, so no client or function can skip a state. |
| 8 | Concurrent finalize calls were not addressed. | A time-limited claim column stops two workers processing the same meeting. A crashed claim expires after 10 minutes. |
| 9 | No limit on recording size or length. | 32 kbps mono opus gives about 14 MB per hour. The bucket caps objects at 50 MB, so one session processes up to about 45 MB (roughly 3 hours). Longer meetings need split sessions or a larger limit (see Open questions). |
| 10 | Crash recovery was described, not designed. | Every chunk is written to IndexedDB before upload. A "Recover physical meeting" panel resumes uploads, ends the meeting and makes the transcript. Confirmed chunks drop their audio bytes locally. |
| 11 | Transcript corrections were vague. | Corrections are an append-only table. The viewer applies the latest name per speaker key. Raw provider output is never edited. Reprocessing writes a new revision and leaves older ones. |
| 12 | Decisions and action items were listed as Phase 0 to 1 outputs. | They need a language model, and none is configured in this project. They move to Phase 4 and are marked as proposals only. Phase 1 delivers transcript, provider summary and topics. |
| 13 | Setup mixed "live" and "after the meeting" behaviour. | One switch. Live on: rough text while talking plus a clean transcript after. Live off: record now, transcribe after. Both end in the same record. |

## Product decisions (unchanged, confirmed)

- One laptop, phone or iPad is the room recorder. Speaker names are best effort: `Speaker 1`, `Speaker 2`, renameable afterwards.
- Online participants accept before joining a recorded meeting. For a physical room the host attests that everyone present was told and agrees. The attestation is stored in the same transaction that creates the session, so a session cannot exist without it.
- Live provisional transcript, then a corrected final transcript.
- Access: the host and active RideArrivo employees listed as attendees. External guests get nothing unless the host shares explicitly (Phase 5). Administrators do not get silent access.
- AI action items are proposals. No task is created without a human approving it, using the existing `room_action_to_task()` path.
- Audio retention is chosen per meeting: delete after the transcript is ready (default), 7, 30 or 90 days, or permanent. Deleting audio never deletes the written record.

## Architecture

```text
Browser (physical meeting)
  mic -> MediaRecorder (durable, 10 s chunks) -> IndexedDB -> signed upload -> private bucket
      \-> MediaRecorder (live slices, 8 s)  -> room-ai-transcribe -> provisional text
End meeting -> end_ai_session(expected chunks) -> room-ai-finalize
  verify chunks -> join -> private final file -> provider (diarize, summary, topics)
  -> new transcript revision -> state ready -> database sets delete_after
Cron every 15 min -> room-ai-retention -> delete audio, confirm, record
```

Provider boundary: only `room-ai-transcribe` and `room-ai-finalize` talk to the provider, and the request format lives in `_shared/roomAiCore.ts`. Replacing the provider changes those files, not the schema, the screens or the access rules. The first provider is Deepgram (`DEEPGRAM_API_KEY`, optional `DEEPGRAM_MODEL` and `DEEPGRAM_LANGUAGE`).

## Data model (built)

`workspace_room_ai_sessions`, `workspace_room_ai_attendees`, `workspace_room_ai_consents` (append-only), `workspace_room_ai_chunks`, `workspace_room_recordings`, `workspace_room_transcript_segments` (revisioned), `workspace_room_speaker_corrections` (append-only), `workspace_room_ai_markers`, `workspace_room_ai_audit` (append-only, no transcript text).

Clients have SELECT only. Writes go through checked SECURITY DEFINER functions (`start_physical_ai_session`, `pause_resume_ai_session`, `end_ai_session`, `add_ai_marker`, `correct_ai_speaker`, `set_ai_retention`) or the service role. The `room-ai-recordings` bucket is private with no client policies, so a guessed object path returns nothing.

## Functions (built)

| Function | Auth | Job |
|---|---|---|
| `room-ai-upload` | active employee, host of the session | Signs a one-chunk upload URL. Acknowledges a chunk only after confirming the stored object exists with the stated size, and records its SHA-256. |
| `room-ai-transcribe` | active employee, host | Live slice to provisional text. Off when the meeting has live transcript disabled. |
| `room-ai-finalize` | active employee, host | Verify, join, transcribe, write revision, mark ready. Idempotent and claim-protected. Never deletes audio. |
| `room-ai-retention` | cron secret | Deletes expired audio, confirms, records. |

## Failure behaviour

- Mic denied or missing: stays on setup, no session starts.
- Mic unplugged mid-meeting: recording pauses and the host is told.
- Offline: recording continues, chunks queue locally, banner says so, uploads resume in order.
- Live text down: recording unaffected, banner says the full transcript comes after.
- Missing or damaged chunk: the meeting moves to `incomplete_upload`, never to `ready`.
- Provider failure: the meeting moves to `failed`, audio is kept, the host can retry.
- Provider key not set: the meeting fails with a clear message and the audio is kept.
- A page reload mid-meeting: the recording stops (browsers cannot continue it), but everything captured so far is recoverable and becomes a transcript.
- Browsers cannot record reliably in the background. The screen warns the host to keep the app open and awake and requests a screen wake lock.

## Privacy and legal

Recording and transcribing people is regulated personal data processing. Before production use, confirm with counsel how the Nigeria Data Protection Act 2023 applies (lawful basis, notice wording, retention, and any cross-border transfer to the transcription provider), and whether the provider's data processing terms and no-training settings are acceptable. The consent text and retention defaults in the app are a starting point, not legal advice.

## Delivery phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Active-employee access predicates, private bucket, audit, state machine, retention clock | Built |
| 1 | Physical meeting: setup, consent, chunked upload with local recovery, live and final transcript, record view, TXT export, retention, speaker rename | Built |
| 2 | Online meetings: consent gate, live panel in `RoomMeeting`, transcript from the video provider | Designed |
| 3 | Hybrid: merge remote participant transcript with the room microphone, duplicate suppression | Designed |
| 4 | Decisions, key moments, action proposals, approve-to-task, reprocess keeping corrections | Designed, needs a language model key |
| 5 | Branded PDF export, external share grants (revocable, expiring), load testing | Designed |

## Operations checklist (Phase 1)

1. Set secrets: `supabase secrets set DEEPGRAM_API_KEY=...` (and `CRON_DISPATCH_SECRET` is already set).
2. Create the Vault secret `cron_dispatch_secret` if missing, then rerun the scheduling block at the end of the migration so the 15 minute retention job exists.
3. Deploy: `room-ai-upload`, `room-ai-transcribe`, `room-ai-finalize`, `room-ai-retention`.
4. Run `supabase/checks/r7-ai-behaviour.sql` against a test database. Every line should end in `|t`.
5. Try one short meeting end to end on a phone and a laptop before wider use.

## Open questions

- Maximum meeting length. Today about 3 hours per session. A longer limit needs a higher bucket cap or splitting into parts.
- Provider cost. Billing is per audio minute for the final pass and per live slice. Set a monthly budget and review usage after the first week.
- Whether guests in a physical room should receive a copy. That is a Phase 5 share grant, decided by the host.
- Whether hosts may delete a transcript. Currently only audio deletion is supported.

## Acceptance criteria (Phase 1)

1. An authorised employee can start a physical meeting from ROOM 7 home with consent and a retention choice.
2. Audio uploads in order, survives a connection drop, and can be recovered after a reload.
3. A live rough transcript is shown when enabled, and a final speaker-labelled transcript replaces it.
4. The host and listed teammates can open the record. Unrelated staff, administrators, deactivated staff and guests cannot.
5. Audio is deleted according to the host's choice, confirmed, and never before the transcript succeeded.
6. Speaker names can be corrected without changing the original transcript.
7. No browser receives a provider key, a service key or a raw storage path.

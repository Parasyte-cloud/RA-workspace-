# RideArrivo Department Communications — System Design

**Date:** 2026-10-13  
**Status:** Approved design, awaiting written-spec review  
**Repository:** `Parasyte-cloud/RA-workspace-`  
**Product surface:** Existing RA-Workspace Chat module  
**Delivery target:** Responsive web + installable PWA

## 1. Purpose

RideArrivo will significantly upgrade the existing internal Chat module into a company-controlled communications system for authenticated RideArrivo employees. The system will preserve private 1-to-1 messaging while adding governed Department Rooms, project/committee rooms, room-scoped files, controlled downloads, audio/video calls, screen sharing, auditability, retention controls, and legal hold.

The design intentionally evolves the current Chat/ROOM 7/RealtimeKit foundations instead of creating a parallel communications product. Supabase remains authoritative for identity, authorization, membership, persistence, and audit state. Cloudflare RealtimeKit remains the media provider for audio/video calls.

## 2. Goals

The first production release must:

- Preserve existing private 1-to-1 employee chats and history.
- Add default Department Rooms linked to official employee department assignments.
- Allow only HR, Director, and explicitly authorized workspace admins to create rooms.
- Automatically add active employees to their department's default room.
- Automatically remove access when an employee changes department or becomes inactive.
- Make the department head the owner/admin of the default department room.
- Allow room owners/admins to manage their own room without gaining authority over other rooms.
- Give default Department Room members access to previous room history.
- Allow sensitive rooms to use `from_join_date` history instead.
- Support real-time messages, threads, reactions, mentions, voice notes, read state, typing, pins, notifications, search, and presence.
- Support audio/video calls in direct chats and rooms.
- Cap group room calls at 25 participants.
- Keep call recording disabled by default.
- Support screen sharing where supported by the browser.
- Limit the system to authenticated, active RideArrivo employees at launch; no external guests.
- Allow file preview for authorized room members, while downloads use RideArrivo's existing controlled-download approval model.
- Allow room owners/admins to approve download requests only for files in their own rooms.
- Allow HR/Director/workspace admins to approve downloads globally.
- Enforce a 25 MB per-file limit and a restricted safe file-type policy.
- Validate file extension, MIME type, and file signature; malware-scan files before normal availability.
- Quarantine files that fail or cannot complete security scanning.
- Enforce configurable retention by conversation/room type and legal holds.
- Restrict legal-hold placement/release to HR, Director, Legal, and workspace admins.
- Maintain an immutable audit trail for privileged operations.
- Provide a production-quality responsive web/PWA experience on desktop, tablet, and mobile.

## 3. Non-goals for the first release

- A separate native iOS or Android application.
- External guest access to Department Chat.
- Call recording.
- End-to-end encryption that prevents RideArrivo from performing compliance retention/audit functions.
- Replacing Supabase Auth or the existing employee identity system.
- Replacing RealtimeKit with a new media provider.
- Creating a second generic ROOM 7 product.
- Destructive removal of existing Chat tables or message history during the initial migration.

## 4. Chosen architecture

### 4.1 Decision

Upgrade the existing Chat system in place.

### 4.2 Why

The repository already contains a direct-message implementation, message editing/deletion, replies, attachments, voice notes, typing state, read state, call history, a global call ringer, ROOM 7 session infrastructure, and Cloudflare RealtimeKit dependencies. Reusing these foundations reduces migration risk and avoids duplicate identity, messaging, notification, and media systems.

### 4.3 Alternatives considered

1. **Parallel Chat V2:** cleaner isolation initially, but creates duplicate message/call/storage/auth flows and a later migration problem.
2. **Standalone communications service:** stronger service isolation, but introduces another identity/authorization boundary and unnecessary operational complexity at current scale.

The chosen design keeps the current stack while introducing clear domain boundaries and stronger authorization.

## 5. High-level architecture

```text
                 RIDEARRIVO WORKSPACE / PWA
                          |
                  Communications
                          |
           +--------------+--------------+
           |                             |
      Direct Messages                Rooms
          1 <-> 1            Department / Project /
                             Committee / Restricted
           |                             |
           +--------------+--------------+
                          |
                Messaging Domain Layer
                          |
      +-------------------+--------------------+
      |                   |                    |
  Messages            Room Access          Presence
  Threads             Membership           Typing
  Reactions           Roles                Read state
  Mentions            History policy       Notifications
      |                   |                    |
      +-------------------+--------------------+
                          |
                     Supabase
              Auth + Postgres + RLS
                          |
       +------------------+--------------------+
       |                  |                    |
   File Service      Audit/Governance      Call Service
       |                  |                    |
 Private Storage     Immutable events     RealtimeKit
 Malware status      Retention/hold       Audio/video
 Preview grants      Download approval    Screen share
```

Supabase/Postgres is the source of truth. Realtime, React UI, and RealtimeKit do not make authorization decisions independently.

## 6. Identity and employee eligibility

A valid Supabase session is necessary but not sufficient. Every sensitive operation must also verify that the corresponding `employee_profiles` row exists and `active = true`.

At launch, Department Communications is strictly internal. No guest, contractor, partner, or public ROOM 7 identity can access Department Chat unless the product is explicitly redesigned later.

When an employee becomes inactive:

- all room access is revoked immediately;
- new messages/posts/uploads are denied;
- room file previews/download approvals are denied;
- new call tokens cannot be issued;
- active call participation should be actively revoked/kicked where possible;
- historical messages remain in company records;
- the revocation is audited.

## 7. Conversation model

The existing `social_conversations` foundation remains in place and is extended additively.

Recommended logical field:

```text
conversation_kind:
- direct
- department
- project
- committee
- restricted
```

`is_group` may remain temporarily for backward compatibility, but new behavior should derive from the authoritative kind/model rather than scattered boolean checks.

Direct conversations remain exactly two active employee participants.

Room conversations use explicit room metadata and membership roles.

## 8. Room model

Recommended room metadata:

```text
chat_rooms
- conversation_id PK/FK -> social_conversations
- room_type
- department nullable
- description
- status: active | archived
- history_policy: full | from_join_date
- retention_days
- legal_hold_active
- created_by
- created_at
- archived_at nullable
```

### 8.1 Default Department Rooms

A default room exists for each active company department.

Rules:

- membership is synchronized from `employee_profiles.department`;
- new department members are automatically added;
- changing department removes the old default-room membership and adds the new one atomically;
- full room history is available by default;
- the department head is automatically owner/admin;
- HR/Director/workspace admins retain global administrative authority;
- department membership changes are audited.

### 8.2 Additional rooms

Only HR, Director, and explicitly authorized workspace admins may create project, committee, topic, or restricted rooms.

Regular members cannot create rooms.

The creator becomes the initial owner unless another owner is explicitly selected.

Room owners may appoint room admins for that room.


## 8.3 Room administration limits

Room owner/admin authority is scoped to the room they administer. They may manage membership, pins, room description/settings, and same-room download approvals. They may rename or archive additional project/committee rooms they own/administer. Default Department Rooms are structural company rooms: a room owner may manage their day-to-day settings and membership exceptions, but archiving/decommissioning a default Department Room requires global Chat-admin authority and must correspond to an approved department lifecycle change.

## 9. Department-head authority

Do not infer leadership from job-title text.

Use an explicit assignment table or equivalent authoritative structure:

```text
workspace_department_leads
- department
- employee_id
- assigned_by
- assigned_at
- ended_at nullable
```

Changing the active department lead must transfer default-room ownership in an auditable transaction.

## 10. Membership model

Extend the current conversation-membership model additively.

Logical fields:

```text
social_conversation_members
- conversation_id
- user_id
- joined_at
- last_read_at
- archived_at
- room_role: member | admin | owner
- added_by
- removed_at
- history_from
```

For DMs, room roles are not meaningful.

For rooms, role and membership status are authoritative.

Removed membership must deny access at the database/RPC layer, not only hide UI.

## 11. History visibility

Default Department Rooms use `full` history.

Other rooms may use:

- `full`
- `from_join_date`

For `from_join_date`, RLS/message-access functions must enforce:

```text
message.created_at >= membership.history_from
```

The frontend must not be the only enforcement layer.

## 12. Authorization model

RLS and secured RPCs are the primary authorization boundary.

Recommended reusable authorization helpers include:

```text
is_active_employee()
is_workspace_chat_admin()
is_conversation_member(conversation_id)
is_room_admin(conversation_id)
can_read_message(message_id)
can_write_to_conversation(conversation_id)
can_preview_room_file(file_id)
can_approve_room_download(file_id)
can_manage_legal_hold(room_id)
```

All helpers must be carefully scoped, use controlled `search_path`, avoid recursive RLS traps, and grant execution only to appropriate authenticated roles.

Privileged mutations must not trust caller-supplied employee IDs for identity; use `auth.uid()` as the authoritative actor.

## 13. Role hierarchy

Global Chat authority must be capability-driven, not inferred from job-title strings. Use an explicit grant/capability source (for example, a dedicated `workspace_chat_admin_grants` table or the repository's existing audited capability framework if one already provides an equivalent primitive). Seed/assign that capability to the approved HR, Director, and workspace-admin identities. Adding another Chat admin later must be a data change, not a code deployment.

Global authority:

- HR
- Director
- workspace admin

Room-scoped authority:

- room owner
- room admin

Department-head authority:

- automatic owner/admin of their default department room

Legal hold authority:

- HR
- Director
- Legal
- workspace admin

Regular members have no room creation, membership management, download approval, or legal-hold authority.

## 14. Messaging capabilities

The upgraded system supports:

- real-time messages;
- threaded replies;
- edit own messages under policy;
- permitted deletion/soft deletion;
- admin moderation where authorized;
- emoji reactions;
- `@person` mentions;
- room-wide mentions under policy;
- delivery/read state;
- typing indicator;
- pins;
- voice notes;
- attachments;
- search;
- online/away presence;
- room notification preferences.

Existing working message functionality should be preserved wherever compatible.

## 15. Message reliability

Realtime is a delivery accelerator, not the source of truth.

On reconnect:

1. fetch canonical persisted state;
2. reconcile messages;
3. re-establish realtime subscriptions.

Message sends should use a client-generated idempotency key so retrying a failed send cannot duplicate the message.

UI states:

- `Sending...`
- `Sent`
- `Failed to send` with explicit retry

A disconnected browser must never show an unsent message as successfully delivered.

Draft text should remain locally in the composer while disconnected.

## 16. System events

Membership, room, call, and governance events may appear in the conversation timeline as structured system events rather than fake user messages.

Examples:

- member joined/left;
- room renamed;
- call started/ended;
- room archived;
- pinned item changed.

Audit events and timeline events are related but not identical. Audit records are immutable governance records; timeline events are user-facing activity records.

## 17. Frontend component architecture

`ChatModule.tsx` should become a thin orchestration shell rather than continue growing.

Recommended domain layout:

```text
src/
├── modules/
│   └── ChatModule.tsx
└── chat/
    ├── ChatShell.tsx
    ├── types.ts
    ├── conversations/
    ├── messages/
    ├── rooms/
    ├── files/
    ├── calls/
    ├── hooks/
    └── api/
```

Illustrative components:

```text
conversations/
- ConversationSidebar
- DirectMessageList
- RoomList
- ConversationSearch

messages/
- MessageTimeline
- MessageItem
- MessageComposer
- ThreadPanel
- Reactions
- VoiceNote

rooms/
- RoomDetails
- RoomMembers
- RoomSettings
- RoomCreator
- RoomAdminPanel

files/
- ChatFileCard
- FilePreview
- DownloadRequest
- RoomFileManager

calls/
- CallLauncher
- CallPreflight
- ActiveCall
- RoomCallBanner
- IncomingCall
```

Components should remain focused and depend on typed domain APIs/hooks rather than issue scattered raw Supabase queries throughout UI code.

## 18. Desktop UX

Use a three-pane layout:

1. left: rooms/direct messages/search;
2. center: active timeline and composer;
3. right: context/details.

The left side groups:

- Department Rooms
- Project/Committee Rooms
- Direct Messages

Each item may show unread/mention counts, muted state, active-call state, and DM presence.

The right pane is context-sensitive.

For rooms:

- About
- Members
- Pinned messages
- Files
- Links
- Calls
- Room settings

For DMs:

- Employee profile
- Shared files
- Shared links
- Call history
- Mute settings

## 19. Mobile/PWA UX

Use navigation transitions rather than squeezing three columns onto a phone.

Mobile flow:

1. conversation list;
2. selected conversation;
3. room/details sheet/page.

Requirements:

- large touch targets;
- no hover-only controls;
- incoming-call surfaces usable on mobile;
- deep-link push notifications into the correct conversation;
- reconnect after temporary network loss;
- installable PWA behavior;
- reduced-motion support;
- keyboard/focus accessibility on supported devices.

Web/PWA is the launch platform. Native iOS/Android apps are out of scope.

## 20. Calls architecture

Both direct chats and rooms support audio/video calls.

Direct calls:

- maximum two participants.

Room calls:

- maximum 25 participants.

Capabilities:

- voice call;
- video call;
- device preflight;
- mute;
- camera on/off;
- participant roster;
- screen share where supported;
- leave;
- room owner/admin may remove a participant from an active call in that same room; all moderation remains room-scoped and server-authorized;
- call start/end/participation timeline events;
- incoming-call notification/ringer throughout RA-Workspace.

Recording remains disabled by default.

## 21. Dedicated Chat call service

Department Chat should not rely on the generic ROOM 7 code-based join path as its authorization model.

Create or evolve a dedicated Edge Function boundary such as:

```text
chat-call-session
```

Responsibilities:

- validate Supabase bearer token;
- require active employee profile;
- verify direct/room conversation membership;
- verify conversation/room status;
- enforce 25-person group capacity;
- reserve participant seat transactionally;
- create/refresh RealtimeKit participant credentials;
- persist call/participant state;
- audit privileged call actions;
- kick/revoke participants who lose access where possible;
- never expose Cloudflare server API credentials to the browser.

RealtimeKit remains the media provider.

## 22. Call data model

Evolve the current direct-call model so room calls are first-class.

Recommended logical tables:

```text
chat_calls
- id
- conversation_id
- started_by
- kind: voice | video
- status: ringing | active | ended | failed
- provider_meeting_id
- capacity
- created_at
- started_at
- ended_at
```

```text
chat_call_participants
- call_id
- user_id
- invited_at
- accepted_at
- joined_at
- left_at
- provider_participant_id
- participant_role
```

Existing direct-call history must be preserved/backfilled rather than discarded.

## 23. Capacity race prevention

Do not enforce the 25-participant limit using an unlocked count-then-insert pattern.

Use an atomic/transactional reservation mechanism:

1. lock the active call row or use equivalent serialized logic;
2. clear expired seat reservations;
3. count active plus reserved seats;
4. reject if capacity is reached;
5. reserve a seat for the caller;
6. commit;
7. request the RealtimeKit participant token;
8. release reservation on provider failure.

Reservations must expire automatically to handle browser crashes during join.

Participant #26 must be deterministically denied.

## 24. Call permission transition

Existing legacy calling allowlists may remain temporarily for backward compatibility, but the new Department Communications call authorization is based on:

```text
active employee
+
active conversation membership
```

Room membership must be rechecked before issuing media credentials.

## 25. Files and storage

File rules at launch:

- maximum 25 MB per file;
- approved document types: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV;
- approved image types: JPG/JPEG, PNG, WEBP;
- approved media types: M4A, MP3, WAV, MP4, WEBM;
- macro-enabled Office formats such as DOCM/XLSM/PPTM are blocked;
- executables, scripts, generic archives, HTML, SVG, and other active/high-risk formats are blocked by default;
- OOXML files (DOCX/XLSX/PPTX) are recognized as structured ZIP containers and validated as Office packages rather than accepted as generic archives;
- validate claimed MIME, extension, and file signature/magic bytes;
- private storage only;
- no permanent public bucket URL;
- only authorized conversation members may preview clean files.

The exact allowlist should be encoded centrally and regression-tested.

## 26. File scanning lifecycle

Use a quarantine-first lifecycle:

```text
upload
-> client preflight
-> private quarantine object
-> server type/signature/size validation
-> malware scan
-> clean: activate metadata and allow preview
-> suspicious: quarantine/reject
-> scanner unavailable: remain pending and inaccessible
```

Never label a file clean without a successful scanner result.

### 26.1 Scanner service contract

Implement scanning behind a server-only adapter such as `chat-file-scan`. The adapter is configured with an authenticated private malware-scanner endpoint and never exposes scanner credentials to the browser. Production file sharing is not considered launch-ready until this endpoint is configured and passes clean-file, malicious-file, timeout, and unavailable-service tests. A scanner timeout, configuration error, non-success response, or indeterminate result leaves the file in `pending` or moves it to `quarantined`; it never falls through to `clean`. The scanner provider can be replaced later without changing room/file authorization semantics.

Recommended metadata:

```text
chat_files
- id
- conversation_id
- message_id nullable
- uploader_id
- storage_path
- original_name
- mime_type
- detected_mime
- size_bytes
- sha256
- scan_status: pending | clean | quarantined | rejected
- created_at
- retention_until
```

## 27. Preview and download policy

Preview permission requires:

- active employee;
- current conversation membership;
- file scan status = clean;
- history-policy eligibility where applicable.

Downloading additionally requires approved controlled-download access.

Browser preview is not DRM. The product may use short-lived signed preview URLs, inline content disposition, and watermarking where useful, but must not claim rendered bytes are technically impossible to save.

## 28. Controlled-download integration

Reuse the existing `workspace_download_requests` governance model rather than create a second approval system.

Do not let the browser submit arbitrary chat resource identifiers directly to the generic request function.

Use chat-specific wrappers such as:

```text
request_chat_file_download(file_id, reason)
review_chat_file_download(request_id, decision, note, expiry)
```

The server resolves the canonical file, conversation, resource key, and name.

Approval policy:

- HR/Director/workspace admin: any chat/room file;
- room owner/admin: only files in rooms they administer;
- ordinary member: cannot approve;
- requester cannot self-approve unless they independently hold an authorized admin role and policy explicitly permits that case.

Every request, approval, denial, revocation, and completed download is audited.

## 29. Audit model

Create an append-only communications audit stream.

Recommended logical structure:

```text
chat_audit_events
- id
- actor_id
- conversation_id nullable
- target_user_id nullable
- target_file_id nullable
- event_type
- metadata jsonb
- request_context containing only the minimum privacy-safe request metadata approved for audit use
- created_at
```

Representative events:

```text
room.created
room.renamed
room.archived
member.added
member.removed
member.role_changed
department.auto_join
department.auto_leave
file.uploaded
file.quarantined
download.requested
download.approved
download.denied
download.revoked
download.completed
legal_hold.placed
legal_hold.released
call.started
call.joined
call.left
call.ended
```

Normal authenticated clients may not update or delete audit rows.

Privileged changes should write their audit event in the same database transaction whenever feasible. If the required audit write fails, the privileged mutation should fail rather than silently become unaudited.

## 30. Retention policy

Default policy:

- Department Rooms: 7 years;
- Project/Committee Rooms: 3 years;
- Direct messages: 3 years;
- HR/Legal/Executive/Investigation or other restricted rooms: configurable, default 7 years.

Archived rooms are read-only but continue to follow retention and legal-hold policy.

Retention should be represented as policy/data, not scattered hard-coded frontend logic.

## 31. Legal hold

Authorized roles:

- HR
- Director
- Legal
- workspace admin

Room owners/admins do not gain legal-hold authority merely by administering a room.

When legal hold is active, covered messages/files are not purged even if the normal retention period has expired.

Placement and release are audited.

## 32. Retention maintenance

A scheduled maintenance process may mark/purge content only when:

```text
legal hold = false
AND
retention period expired
AND
no other preservation requirement applies
```

Database records and storage objects must be handled coherently to avoid orphaned files or metadata.

Destructive retention processing should be idempotent and observable.

## 33. Search

Search scope eventually includes:

- messages;
- rooms;
- people;
- files;
- pinned items.

Authorization filtering must occur before unauthorized records are returned.

Restricted room names, snippets, file names, or metadata must not leak through search results to non-members.

## 34. Notifications

Notification categories:

- direct message;
- mention;
- room activity;
- call;
- governance state changes such as download decision or access removal.

Per-room preferences:

- all activity;
- mentions only;
- muted.

Access-removal, download-decision, legal-hold, and security/quarantine notifications are not suppressible by per-room mute settings.

In-app notifications are authoritative for workspace behavior; PWA/browser push complements them and should deep-link into the correct conversation.

## 35. Error and failure handling

### Realtime disconnect

Persisted state remains canonical. Reconnect and reconcile before resuming live delivery.

### Message send failure

Show failure explicitly and permit idempotent retry.

### Network loss

Preserve draft; never claim unsent content was accepted.

### Scanner unavailable

Keep file `pending`; no preview/download.

### RealtimeKit unavailable

Chat remains usable; calls show a temporary-unavailable state. Do not fall back to insecure meeting links.

### Partial call creation failure

If provider creation succeeds but DB persistence fails, deactivate the provider meeting and release reservations.

If DB state exists but provider creation fails, mark call failed/ended, release reservations, and record the failure/audit state.

### Access revoked during active session

New database operations fail immediately, and call service should revoke/kick the participant where practical.

## 36. Security requirements

- No service-role key in browser code.
- RealtimeKit API credentials remain server-side only.
- RLS is authoritative; UI hiding is not authorization.
- Sensitive mutations use secured RPC/Edge Function boundaries.
- `auth.uid()` is authoritative actor identity.
- Exact-origin CORS for sensitive Edge Functions.
- Private storage for chat files.
- Short-lived preview grants where signed URLs are used.
- Membership rechecked at file and call access time.
- Room ownership never grants global authority.
- Search does not leak restricted metadata.
- Archived/removed/offboarded states fail closed.
- Dangerous upload types are rejected.
- Security/audit functions use safe `search_path` and explicit grants.

## 37. Accessibility requirements

- keyboard navigation;
- visible focus states;
- semantic controls;
- ARIA names for media controls;
- live-region announcements for incoming calls, send failures, and other time-sensitive state changes;
- sufficient color contrast;
- no status conveyed only by color;
- reduced-motion support;
- adequate mobile touch targets;
- call UI usable without hover.

## 38. Test strategy

Implementation is test-first.

### 38.1 Unit tests

Test pure helpers and UI/domain rules such as:

- file-type policy;
- history visibility calculations;
- room role capabilities;
- call capacity representation;
- notification preference behavior;
- retry/idempotency logic.

### 38.2 Database/RLS security tests

Use multiple identities and direct database/RPC calls.

Minimum authorization matrix:

- ordinary member;
- department head;
- room admin;
- HR;
- Director;
- Legal;
- workspace admin;
- inactive employee;
- employee from another department.

Required examples:

```text
Finance member -> Finance room                  ALLOW
Finance member -> HR restricted room            DENY
Marketing head -> Marketing room admin          ALLOW
Marketing head -> Finance room admin            DENY
Removed member -> old room messages             DENY
Removed member -> old room files                DENY
Restricted-history member -> older messages     DENY
Room owner -> approve same-room download        ALLOW
Room owner -> approve other-room download       DENY
Ordinary member -> place legal hold              DENY
Legal/HR/Director/admin -> legal hold            ALLOW
Participant #25 -> join room call               ALLOW
Participant #26 -> join room call               DENY
```

### 38.3 Integration tests

Test:

- department assignment -> default room membership;
- department transfer -> atomic revocation/grant;
- inactive employee -> immediate access loss;
- room owner transfer when department lead changes;
- upload -> quarantine -> clean activation;
- download approval lifecycle;
- call start/join/end;
- seat reservation cleanup;
- Realtime reconnect reconciliation.

### 38.4 Existing-suite regression

Run the complete existing RA-Workspace test suite and ensure unrelated modules remain green.

### 38.5 Build gates

At minimum:

```bash
npm test
npm run typecheck
npm run build
npm run test:supabase
npm audit --omit=dev --audit-level=high
```

A clean-database migration test is required in addition to upgrade testing.

## 39. Migration strategy

All initial migrations are additive and backward-compatible.

### Migration 1 — Room foundation

Add:

- conversation kind/model support;
- `chat_rooms`;
- room role/history metadata;
- department-lead assignments;
- authorization helpers;
- RLS/policies.

Existing DMs continue working.

### Migration 2 — Department synchronization

Add:

- default Department Rooms;
- automatic department membership;
- department-owner synchronization;
- offboarding revocation;
- audit events.

### Migration 3 — File governance

Add:

- `chat_files`;
- quarantine lifecycle;
- private storage policies;
- chat-specific download request/review wrappers;
- room-admin approval enforcement.

### Migration 4 — Calls V2

Add/evolve:

- group-capable call state;
- call participants;
- transactional seat reservations;
- conversation-membership authorization;
- dedicated chat-call Edge Function boundary.

Preserve/backfill existing direct-call history.

### Migration 5 — Governance

Add:

- retention policy structures;
- legal holds;
- retention maintenance;
- administrative audit views.

Only after these layers pass tests should the frontend fully switch to the new room-first UX.

## 40. Deployment sequence

1. Create an isolated feature branch/worktree.
2. Snapshot/backup the production Supabase project before database changes.
3. Verify current migration history and remote/local alignment.
4. Write failing tests before each behavior/security change.
5. Run migrations against a clean local Supabase stack.
6. Run migrations against an upgrade copy of current schema/data.
7. Run RLS tests using separate representative identities.
8. Deploy new/updated Edge Functions.
9. Verify call and file APIs independently.
10. Run full local test/typecheck/build/audit gates.
11. Open PR with explicit migration and rollout notes.
12. Review and merge only when checks are green.
13. Apply production database migrations before frontend code that depends on them.
14. Deploy Edge Functions.
15. Deploy Cloudflare Pages frontend.
16. Run desktop/tablet/mobile/PWA acceptance.
17. Run multi-user realtime acceptance.
18. Run direct-call and 25-person room-call acceptance.
19. Run offboarding/access-revocation acceptance.
20. Run controlled-download acceptance.
21. Run post-deploy security and audit review.

## 41. Rollback strategy

Initial database changes remain backward-compatible.

If the new frontend fails after deployment:

- roll Cloudflare Pages back to the previous known-good release;
- keep additive database structures in place;
- old direct-chat flows continue to understand legacy-compatible data;
- do not destructively downgrade production data.

Removal of obsolete legacy fields/tables is a separate future migration after a stabilization period and explicit review.

## 42. Definition of done

The release is complete only when all of the following are verified:

- existing direct messages/history are preserved;
- default department rooms exist and membership follows official departments;
- department changes update access atomically;
- department heads receive correct owner/admin authority;
- only HR/Director/workspace admins create rooms;
- room membership cannot be bypassed through direct API/database calls;
- history policy is enforced in RLS;
- messages/threads/reactions/mentions/read state work;
- attachments/voice notes remain functional;
- uploads are size/type/signature validated and malware-scanned;
- suspicious/pending files are not exposed;
- previews require current membership;
- downloads require approved access;
- room owners/admins can approve only their room's files;
- HR/Director/workspace admins can approve globally;
- retention policies work by conversation type;
- legal holds override retention and are role-restricted;
- 1-to-1 audio/video calls work;
- room audio/video calls work up to 25 participants;
- participant #26 is refused safely;
- call recording remains off;
- disabled employees immediately lose communications access;
- privileged actions produce immutable audit events;
- search does not leak restricted metadata;
- desktop, tablet, mobile, and installed-PWA flows work;
- accessibility requirements are met;
- the full existing RA-Workspace suite remains green;
- clean install and upgrade migration paths both pass.

## 43. Resolved product decisions

The following brief decisions are resolved for this design:

- Private 1-to-1 messaging remains alongside rooms.
- Staff are automatically added to their default department room.
- Default department rooms expose previous history to new members.
- Sensitive rooms may use `from_join_date` history.
- Only HR/Director/workspace admins create rooms.
- Both direct chats and rooms support audio/video calls.
- Department Chat is employee-only at launch.
- File downloads use controlled-download approval; preview remains room-scoped.
- Room owners/admins may approve downloads only within their room.
- Department heads are automatic owner/admin of default department rooms.
- Retention varies by room/conversation type.
- Legal hold is restricted to HR, Director, Legal, and workspace admins.
- Maximum upload size is 25 MB with restricted safe file types and malware scanning.
- Maximum room-call participants is 25.
- Web/PWA is the launch platform; no separate native app at launch.

## 44. Implementation discipline

- Use an isolated branch/worktree.
- Keep commits small and coherent.
- Stage only files related to the current change; do not use broad staging in a dirty workspace.
- Write regression/security tests before implementation changes.
- Do not push or merge until local verification is complete and the user chooses the integration step.
- Treat RLS/RPC tests as release gates, not optional validation.

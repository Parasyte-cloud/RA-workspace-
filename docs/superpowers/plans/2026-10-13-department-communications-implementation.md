# Department Communications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing RA-Workspace Chat module into a secure employee-only communications system that preserves direct messages while adding governed Department Rooms, controlled files/downloads, 1-to-1 and group RealtimeKit calls, retention/legal hold, auditability, and responsive PWA behavior.

**Architecture:** Extend the existing `social_conversations`/`social_messages` model additively and keep Supabase Auth/Postgres/RLS authoritative. Split the current large Chat surface into focused `src/chat/*` domain components and APIs; use secured Postgres RPCs for privileged mutations, private storage plus a server-side scan boundary for files, and a dedicated `chat-call-session` Edge Function for membership-authorized RealtimeKit sessions.

**Tech Stack:** React 18, TypeScript, Vite, Supabase Auth/Postgres/RLS/Realtime/Storage/Edge Functions, Cloudflare RealtimeKit, Cloudflare Pages PWA, Node test runner, Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-10-13-department-communications-design.md`

## Global Constraints

- Preserve all existing direct-message history and existing compatible Chat behavior.
- Department Communications is restricted to authenticated, active RideArrivo employees; no external guests at launch.
- Only HR, Director, and explicitly granted workspace Chat admins may create rooms.
- Default Department Room membership follows `employee_profiles.department` automatically; department heads own their default room.
- Default Department Rooms expose full history; restricted rooms may use `from_join_date` enforced server-side.
- Group calls are capped at exactly 25 participants; participant #26 must be denied atomically.
- Call recording remains disabled by default.
- File limit is exactly 25 MB. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV, JPG/JPEG, PNG, WEBP, M4A, MP3, WAV, MP4, WEBM. Macro-enabled Office, executables, scripts, generic archives, HTML, SVG, and active/high-risk formats are blocked.
- Chat files remain unavailable until validation and malware scanning report a clean result; scanner failure/timeout never becomes clean.
- File preview requires current membership and clean scan status; download additionally requires approved controlled-download access.
- Room owners/admins may approve downloads only for files in rooms they administer; HR/Director/workspace Chat admins may approve globally.
- Default retention: Department 7 years; Project/Committee 3 years; Direct Message 3 years; restricted rooms configurable, default 7 years.
- Legal hold may be placed/released only by HR, Director, Legal, or workspace admins and overrides retention purge.
- Privileged mutations and their required audit events must be atomic where feasible.
- RLS/RPC/Edge Functions are authoritative; React visibility is never treated as authorization.
- No service-role or RealtimeKit server credential may enter browser code.
- Do not use `git add .`; stage only task-related paths.

## Review Focus

- **Concurrent department transfer/offboarding:** membership changes must not leave a temporary or stale authorization path; Task 3 tests atomic old-room revoke/new-room grant and inactive-user fail-closed behavior.
- **Cross-room identifier tampering:** a room admin must never approve/download/manage another room by changing IDs; Tasks 4 and 8 include direct RPC/RLS tampering tests.
- **History boundary timestamps:** `from_join_date` must consistently deny messages/files before `history_from`, including equality/timezone edges; Task 4 pins boundary behavior.
- **Call capacity races/provider partial failure:** concurrent #25/#26 joins and failed provider creation must release reservations and never exceed capacity; Tasks 9-10 test both conditions.
- **Scanner indeterminate states:** timeout, malformed response, unavailable scanner, and unsupported file signatures must stay pending/quarantined and inaccessible; Tasks 7-8 cover these cases.

---

## Delivery Strategy

Implement as four reviewable PR-sized slices on one feature branch/worktree, with a reviewer gate after each slice:

1. **Foundation + Department Rooms + messaging shell** (Tasks 1-6)
2. **Files + controlled downloads** (Tasks 7-8)
3. **Calls V2** (Tasks 9-10)
4. **Governance + UX/PWA hardening + final audit** (Tasks 11-14)

The branch must remain backwards-compatible with existing DMs until the final UI switch is verified.

### Task 1: Establish isolated worktree and clean baseline

**Files:**
- No product-code changes expected.
- Inspect: `package.json`, `.github/workflows/ci.yml`, `scripts/run-tests.mjs`, `supabase/config.toml`

**Interfaces:**
- Consumes: repository `main` after PR #163 design spec is merged.
- Produces: isolated branch `feat/department-communications-v2` with a known-green baseline.

- [ ] **Step 1: Create/enter an isolated worktree from fresh `main`**

Use `superpowers:using-git-worktrees`; do not reuse the documentation branch.

- [ ] **Step 2: Install exact dependencies**

Run: `npm ci`
Expected: exit 0.

- [ ] **Step 3: Run baseline verification**

Run:
```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```
Expected: all commands exit 0. If any baseline fails, stop and debug before feature work.

- [ ] **Step 4: Record baseline commit SHA and migration tail**

Run:
```bash
git rev-parse HEAD
ls supabase/migrations | tail -n 10
```
Expected: clean worktree and known latest migration filename.

### Task 2: Add room/domain schema and capability primitives

**Files:**
- Create: `supabase/migrations/20261013100000_chat_rooms_foundation.sql`
- Create: `scripts/chat-room-foundation.contract.test.mjs`
- Modify: `scripts/run-tests.mjs` only if needed for test discovery conventions

**Interfaces:**
- Consumes: existing `social_conversations`, `social_conversation_members`, `employee_profiles`, existing workspace admin helpers.
- Produces: `conversation_kind`, `chat_rooms`, `workspace_chat_admin_grants`, `workspace_department_leads`, membership role/history fields, and authorization helpers `is_active_employee()`, `is_workspace_chat_admin()`, `is_conversation_member(uuid)`, `is_room_admin(uuid)`, `can_write_to_conversation(uuid)`.

- [ ] **Step 1: Write failing contract tests**

Assertions: migration is additive; exact enum/check values exist; helper functions are `SECURITY DEFINER` with controlled `search_path`; anon privileges are revoked; room creation is not directly writable by ordinary authenticated clients.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test scripts/chat-room-foundation.contract.test.mjs`
Expected: FAIL because migration/schema objects do not exist.

- [ ] **Step 3: Implement the additive migration**

Required values: `direct|department|project|committee|restricted`, room status `active|archived`, history policy `full|from_join_date`, room role `member|admin|owner`.

- [ ] **Step 4: Re-run focused and full Node suites**

Run:
```bash
node --test scripts/chat-room-foundation.contract.test.mjs
npm test
```
Expected: PASS.

- [ ] **Step 5: Commit only Task 2 files**

```bash
git add supabase/migrations/20261013100000_chat_rooms_foundation.sql scripts/chat-room-foundation.contract.test.mjs scripts/run-tests.mjs
git commit -m "feat(chat): add governed room foundation"
```

### Task 3: Synchronize Department Rooms and department-head ownership

**Files:**
- Create: `supabase/migrations/20261013110000_chat_department_sync.sql`
- Create: `scripts/chat-department-sync.test.mjs`
- Modify: `package.json` to include this suite in `test:supabase`

**Interfaces:**
- Consumes: Task 2 helpers/tables; `employee_profiles.department`, `employee_profiles.active`.
- Produces: secured `sync_employee_department_room(uuid)`, `set_department_lead(text, uuid)`, default-room creation/sync logic, audited auto-join/auto-leave/owner-transfer behavior.

- [ ] **Step 1: Write Supabase integration tests before SQL**

Test names/assertions:
- `active employee is auto-added to matching default department room with full history`
- `department transfer atomically revokes old room and grants new room`
- `inactive employee loses all room access immediately`
- `department lead becomes owner and old lead loses owner role when assignment changes`
- `ordinary employee cannot self-assign department lead or membership`

- [ ] **Step 2: Run focused local Supabase test and confirm failure**

Run: `node --test scripts/chat-department-sync.test.mjs`
Expected: FAIL on missing RPCs/schema behavior.

- [ ] **Step 3: Implement synchronization transaction and audit writes**

Use `auth.uid()` for actor in user-triggered functions and server-owned trigger context for automatic lifecycle events. Never infer lead from job title.

- [ ] **Step 4: Run focused Supabase suite**

Run: `npm run test:supabase`
Expected: all included Supabase suites PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261013110000_chat_department_sync.sql scripts/chat-department-sync.test.mjs package.json
git commit -m "feat(chat): sync department room membership"
```

### Task 4: Enforce room message/history authorization and idempotent sends

**Files:**
- Create: `supabase/migrations/20261013113000_chat_message_authorization.sql`
- Create: `scripts/chat-message-security.test.mjs`
- Create: `src/chat/api/chatApi.ts`
- Create: `src/chat/types.ts`
- Create: `scripts/chat-api.test.mjs`

**Interfaces:**
- Consumes: Task 2 room/membership helpers; existing `social_messages`.
- Produces: `send_chat_message(conversation_id, body, reply_to_id, client_message_id)`, history-aware read policies, typed `sendMessage()` API and `ChatMessage`/`ConversationSummary` types.

- [ ] **Step 1: Write failing DB tests**

Assertions: current member may read/write; removed/inactive/foreign-room employee cannot; `from_join_date` denies `< history_from`, permits `>= history_from`; duplicate `client_message_id` returns same persisted message instead of inserting twice.

- [ ] **Step 2: Run and confirm DB failures**

Run: `node --test scripts/chat-message-security.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement secured message RPC/RLS changes**

Preserve existing DM semantics and existing reply same-conversation protection.

- [ ] **Step 4: Write failing frontend API tests**

Test `sendMessage()` maps success/failure and reuses the same client id on retry.

- [ ] **Step 5: Implement typed `chatApi.ts`**

Signature:
```ts
sendMessage(input: { conversationId: string; body: string; replyToId?: string | null; clientMessageId: string }): Promise<ChatMessage>
```

- [ ] **Step 6: Run focused + full tests**

Run:
```bash
node --test scripts/chat-message-security.test.mjs scripts/chat-api.test.mjs
npm test
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261013113000_chat_message_authorization.sql scripts/chat-message-security.test.mjs scripts/chat-api.test.mjs src/chat/api/chatApi.ts src/chat/types.ts
git commit -m "feat(chat): enforce room message authorization"
```

### Task 5: Split the Chat shell and preserve direct messages

**Files:**
- Modify: `src/modules/ChatModule.tsx`
- Create: `src/chat/ChatShell.tsx`
- Create: `src/chat/hooks/useConversations.ts`
- Create: `src/chat/hooks/useMessages.ts`
- Create: `src/chat/conversations/ConversationSidebar.tsx`
- Create: `src/chat/conversations/DirectMessageList.tsx`
- Create: `src/chat/conversations/RoomList.tsx`
- Create: `src/chat/messages/MessageTimeline.tsx`
- Create: `src/chat/messages/MessageComposer.tsx`
- Create: `scripts/chat-shell.test.mjs`

**Interfaces:**
- Consumes: Task 4 typed API/types; existing attachments/voice/edit/call helpers.
- Produces: thin `ChatModule`, room-aware shell, stable direct-message behavior, explicit send states `sending|sent|failed`.

- [ ] **Step 1: Write failing source/UI contract tests**

Assert `ChatModule` delegates to `ChatShell`; sidebar renders separate Rooms and Direct Messages sections; composer has explicit failed/retry state; existing direct-message call/voice/attachment hooks remain reachable.

- [ ] **Step 2: Run test and confirm failure**

Run: `node --test scripts/chat-shell.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Extract the smallest coherent shell without redesigning unrelated behavior**

Keep existing direct-message features working while routing data through focused hooks/APIs.

- [ ] **Step 4: Verify**

Run:
```bash
node --test scripts/chat-shell.test.mjs
npm test
npm run typecheck
npm run build
```
Expected: PASS.

- [ ] **Step 5: Commit**

Stage only the listed Chat paths and test; commit `refactor(chat): establish communications shell`.

### Task 6: Add room creation, membership administration, details panel, and responsive navigation

**Files:**
- Create: `src/chat/api/roomApi.ts`
- Create: `src/chat/rooms/RoomCreator.tsx`
- Create: `src/chat/rooms/RoomDetails.tsx`
- Create: `src/chat/rooms/RoomMembers.tsx`
- Create: `src/chat/rooms/RoomSettings.tsx`
- Create: `src/chat/rooms/RoomAdminPanel.tsx`
- Create: `src/chat/conversations/ConversationSearch.tsx`
- Modify: `src/chat/ChatShell.tsx`
- Modify: relevant Chat CSS/module stylesheet used by current Chat surface
- Create: `scripts/chat-room-ui.test.mjs`

**Interfaces:**
- Consumes: Task 2/3 RPCs and capability helpers.
- Produces: typed `createRoom`, `addRoomMember`, `removeRoomMember`, `setRoomMemberRole`, `archiveRoom`; desktop three-pane and mobile list→conversation→details flow.

- [ ] **Step 1: Write failing tests for capability-driven UI**

Assert ordinary member has no create-room action; Chat admin can create; room owner sees same-room admin controls but not global controls; mobile layout does not depend on hover.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --test scripts/chat-room-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement typed room API and UI**

Keep structural Department Room archive/decommission action global-admin-only.

- [ ] **Step 4: Verify slice 1**

Run:
```bash
npm test
npm run typecheck
npm run build
npm run test:supabase
```
Expected: PASS. Perform manual desktop/mobile smoke test of existing DMs and new room navigation before proceeding.

- [ ] **Step 5: Commit**

Commit `feat(chat): add department room experience`.

### Task 7: Add file policy, quarantine metadata, and scanner boundary

**Files:**
- Create: `supabase/migrations/20261013120000_chat_file_governance.sql`
- Create: `src/chat/files/filePolicy.ts`
- Create: `supabase/functions/chat-file-scan/index.ts`
- Create: `scripts/chat-file-policy.test.mjs`
- Create: `scripts/chat-file-scan.contract.test.mjs`

**Interfaces:**
- Consumes: room membership/history authorization.
- Produces: `chat_files`, exact 25 MB/type/signature policy, scan states `pending|clean|quarantined|rejected`, server-only scan adapter.

- [ ] **Step 1: Write failing file-policy tests**

Cover every allowed extension/type, macro-enabled Office rejection, SVG/HTML/archive/script rejection, >25 MB rejection, MIME/extension mismatch, OOXML package allowance.

- [ ] **Step 2: Write failing scan-boundary tests**

Assert timeout/unconfigured/non-2xx/malformed/indeterminate results never become `clean`.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `node --test scripts/chat-file-policy.test.mjs scripts/chat-file-scan.contract.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement central policy and Edge Function contract**

No scanner credential in browser/env prefixed `VITE_`. Scan endpoint credentials remain server-side secrets.

- [ ] **Step 5: Verify and commit**

Run `npm test && npm run typecheck && npm run build`; commit `feat(chat): quarantine and scan shared files`.

### Task 8: Integrate room file preview and controlled-download approval

**Files:**
- Create: `supabase/migrations/20261013123000_chat_download_governance.sql`
- Create: `src/chat/api/fileApi.ts`
- Create: `src/chat/files/ChatFileCard.tsx`
- Create: `src/chat/files/FilePreview.tsx`
- Create: `src/chat/files/DownloadRequest.tsx`
- Create: `src/chat/files/RoomFileManager.tsx`
- Modify: `src/modules/AdminDownloadAccessManager.tsx` only to surface chat resources through existing workflow
- Create: `scripts/chat-download-security.test.mjs`
- Create: `scripts/chat-file-ui.test.mjs`

**Interfaces:**
- Consumes: existing `workspace_download_requests`, Task 7 `chat_files`.
- Produces: `request_chat_file_download(uuid,text)`, `review_chat_file_download(uuid,text,text,timestamptz)`, membership-safe preview API, same-room approval enforcement.

- [ ] **Step 1: Write failing security tests**

Assert member can preview clean same-room file; removed/foreign member cannot; owner approves same-room request; owner cannot approve other-room request; ordinary member cannot approve; global authorized admin can approve; arbitrary resource-key tampering is impossible through chat wrapper.

- [ ] **Step 2: Run test and confirm failure**

Run: `node --test scripts/chat-download-security.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement canonical file-id wrappers and storage policies**

Resolve resource key/name server-side and write audit events for request/decision/download.

- [ ] **Step 4: Add preview/request/approval UI and tests**

Preview only `clean`; pending/quarantined show non-downloadable security state.

- [ ] **Step 5: Verify slice 2**

Run all build gates including `npm run test:supabase` and dependency audit.

- [ ] **Step 6: Commit**

Commit `feat(chat): govern room file previews and downloads`.

### Task 9: Add group-capable call schema and atomic seat reservations

**Files:**
- Create: `supabase/migrations/20261013130000_chat_calls_v2.sql`
- Create: `scripts/chat-calls-v2.test.mjs`
- Modify: existing `chat_calls` additively; do not discard history.

**Interfaces:**
- Consumes: conversation membership and active employee helpers.
- Produces: group-capable `chat_calls`, `chat_call_participants`, call-seat reservation primitive, `reserve_chat_call_seat(call_id)` / release/leave functions, backfilled legacy direct-call participant records.

- [ ] **Step 1: Write failing migration/security tests**

Assert existing call rows survive migration; direct call capacity is 2; room call capacity is 25; foreign/removed/inactive users cannot reserve; concurrent/serialized 25th succeeds and 26th fails; expired reservations stop counting.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/chat-calls-v2.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement additive call schema/reservation transaction**

Avoid unlocked count-then-insert logic.

- [ ] **Step 4: Verify Supabase tests and commit**

Commit `feat(chat): add group call capacity model`.

### Task 10: Add dedicated membership-authorized RealtimeKit Chat call service

**Files:**
- Create: `supabase/functions/chat-call-session/index.ts`
- Create: `src/chat/api/callApi.ts`
- Refactor: `src/modules/useChatCalls.ts`
- Refactor: `src/modules/CallRinger.tsx`
- Create: `src/chat/calls/CallLauncher.tsx`
- Create: `src/chat/calls/CallPreflight.tsx`
- Create: `src/chat/calls/ActiveCall.tsx`
- Create: `src/chat/calls/RoomCallBanner.tsx`
- Create: `src/chat/calls/IncomingCall.tsx`
- Create: `scripts/chat-call-session.contract.test.mjs`
- Create: `scripts/chat-call-ui.test.mjs`

**Interfaces:**
- Consumes: Task 9 reservation RPCs; existing RealtimeKit configuration; existing ROOM 7 components only where reusable without guest/code authorization.
- Produces: `createDirectCall`, `createRoomCall`, `joinCall`, `leaveCall`, `endCall`, `removeParticipant`; employee-only server-issued RealtimeKit participant credentials.

- [ ] **Step 1: Write failing Edge Function contract tests**

Assert missing/invalid session 401, inactive employee 403, non-member 403, archived room denied, participant #26 denied, recording disabled, provider credentials never returned, provider failure releases reservation.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/chat-call-session.contract.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `chat-call-session`**

Keep generic external ROOM 7 guest/code flows unchanged; Department Chat does not call them for authorization.

- [ ] **Step 4: Write UI tests and implement call surfaces**

Direct and room call buttons, preflight, 25-person state, global ringer, timeline events, same-room moderation.

- [ ] **Step 5: Verify slice 3**

Run all build gates plus manual two-browser direct call and multi-user room-call smoke test.

- [ ] **Step 6: Commit**

Commit `feat(chat): add secure room audio and video calls`.

### Task 11: Add immutable audit stream, retention policy, and legal hold

**Files:**
- Create: `supabase/migrations/20261013140000_chat_retention_legal_hold.sql`
- Create: `scripts/chat-governance.test.mjs`
- Create/modify: scheduled retention function/config using existing project convention
- Create: `src/chat/rooms/RoomGovernance.tsx`

**Interfaces:**
- Consumes: room/message/file/call tables and role helpers.
- Produces: `chat_audit_events`, retention-policy representation, `place_chat_legal_hold`, `release_chat_legal_hold`, idempotent retention maintenance.

- [ ] **Step 1: Write failing governance tests**

Assert ordinary/room admin cannot place hold; HR/Director/Legal/workspace admin can; hold prevents purge; Department=7y, Project/Committee=3y, DM=3y, restricted default=7y; clients cannot update/delete audit rows.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/chat-governance.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement governance schema/RPCs and idempotent maintenance**

Retention must coordinate DB metadata and storage cleanup without orphaning one side.

- [ ] **Step 4: Verify and commit**

Commit `feat(chat): add retention legal hold and audit governance`.

### Task 12: Add search, pins, reactions, mentions, presence, and notification preferences

**Files:**
- Create/modify focused files under `src/chat/messages/`, `src/chat/hooks/`, `src/chat/conversations/`
- Add additive migration `supabase/migrations/20261013143000_chat_collaboration_features.sql` only for missing schema/RPC support
- Create: `scripts/chat-collaboration.test.mjs`
- Create: `scripts/chat-search-security.test.mjs`

**Interfaces:**
- Consumes: authorized conversation scope.
- Produces: reactions, pins, mentions, room-wide mention policy, presence/typing hooks, notification preferences, authorization-filtered search.

- [ ] **Step 1: Write failing tests**

Assert search never returns restricted room name/snippet/file metadata; per-room mute does not suppress governance notices; typing is ephemeral; reactions/pins require membership.

- [ ] **Step 2: Implement smallest missing domain support and UI**

Reuse existing notification/presence infrastructure where compatible.

- [ ] **Step 3: Verify and commit**

Run full Node/Supabase/build gates; commit `feat(chat): complete collaboration features`.

### Task 13: PWA/mobile/accessibility hardening and reconnect behavior

**Files:**
- Modify: Chat styles/components from Tasks 5-12
- Modify: existing PWA/service-worker/notification integration only where needed
- Create: `scripts/chat-pwa-accessibility.test.mjs`
- Create: `scripts/chat-reconnect.test.mjs`

**Interfaces:**
- Consumes: complete Chat domain.
- Produces: desktop three-pane, tablet-safe layout, mobile list→conversation→details navigation, notification deep links, reduced motion, keyboard/focus semantics, reconnect reconciliation.

- [ ] **Step 1: Write failing behavior/contract tests**

Assert no hover-only critical control, explicit focus labels/ARIA for call controls, reduced-motion class/media query, failed send remains failed/offline draft preserved, reconnect triggers canonical refresh before realtime continuation.

- [ ] **Step 2: Implement responsive/accessibility/reconnect behavior**

Do not report offline queued messages as sent.

- [ ] **Step 3: Verify desktop/tablet/mobile build and PWA**

Run automated gates, then manual widths 320, 360, 375, 390, 430, tablet, desktop; installed-PWA call/message deep-link smoke test.

- [ ] **Step 4: Commit**

Commit `feat(chat): harden communications PWA experience`.

### Task 14: Full migration rehearsal, security matrix, production-readiness review

**Files:**
- Create: `docs/department-communications-release-checklist.md`
- Modify only defects uncovered by verification, each with a regression test first.

**Interfaces:**
- Consumes: entire feature branch.
- Produces: evidence-backed release candidate and deployment order; no production mutation yet.

- [ ] **Step 1: Rehearse migrations on a clean local Supabase project**

Run the project-standard reset/migration command and verify all migrations apply from zero.

- [ ] **Step 2: Rehearse upgrade against a fixture containing legacy DMs/calls/files**

Assert existing message/call history is preserved and readable by authorized participants.

- [ ] **Step 3: Execute complete role/security matrix**

At minimum ordinary member, department head, room admin, HR, Director, Legal, workspace admin, inactive employee, foreign-department employee.

- [ ] **Step 4: Run final gates**

```bash
npm test
npm run typecheck
npm run build
npm run test:supabase
npm audit --omit=dev --audit-level=high
```
Expected: all exit 0, no high-severity production dependency vulnerability.

- [ ] **Step 5: Review git scope**

Run:
```bash
git status --short
git diff --stat main...HEAD
git diff --name-only main...HEAD
```
Expected: only Department Communications implementation, tests, migrations, Edge Function, and docs.

- [ ] **Step 6: Request code review before PR/merge**

Use `superpowers:requesting-code-review`; resolve findings with TDD. Do not merge or deploy automatically.

- [ ] **Step 7: Commit release checklist**

```bash
git add docs/department-communications-release-checklist.md
git commit -m "docs(chat): add communications release checklist"
```

## Production Rollout After Approved Implementation PR

1. Back up/snapshot the production Supabase project and record migration state.
2. Apply additive migrations in order; stop on any mismatch.
3. Verify RLS/RPC behavior with dedicated test identities before frontend cutover.
4. Configure and verify malware-scanner server secret/endpoint; do not enable normal file sharing until clean/malicious/timeout tests pass.
5. Deploy `chat-file-scan` and `chat-call-session` Edge Functions.
6. Verify RealtimeKit create/join/end and participant-cap enforcement independently.
7. Deploy RA-Workspace frontend to Cloudflare Pages.
8. Perform desktop/tablet/mobile/PWA smoke tests, two-user DM tests, department-room tests, controlled-download tests, group-call tests, and offboarding revocation tests.
9. Keep rollback path to the prior Cloudflare Pages deployment while additive DB changes remain backwards-compatible.
10. Only after stabilization consider a separate cleanup PR for obsolete legacy structures; no destructive cleanup in this feature PR.

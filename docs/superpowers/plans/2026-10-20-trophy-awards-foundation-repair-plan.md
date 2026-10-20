# Department Trophy and Personal Awards Foundation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Department Trophy Cabinet for every authorized department viewer, add a private personal awards shelf, replace fragmented seen-state with durable per-recipient ceremony delivery, and add audited Administration governance and preview surfaces.

**Architecture:** Keep `department_achievements`, `employee_recognition_awards`, `PremiumCelebrationStage`, birthday wishes, and current recognition sources. Add server-authoritative department access, RPC-only award DTOs, a central `recognition_ceremony_deliveries` ledger, a single ceremony queue/host, and an Administration module that uses the production renderer without mutating recognition state.

**Tech Stack:** React 19, TypeScript, CSS, Supabase PostgreSQL/RLS/RPC/Realtime, Supabase Edge-compatible authorization patterns, Node test runner, existing RA-Workspace build and Supabase E2E harness.

**Spec:** `docs/superpowers/specs/2026-10-20-department-trophy-personal-awards-seasonal-celebrations-design.md`

## Global Constraints

- Historical production migrations are immutable; all database work is additive.
- Use migrations `20261020290000_recognition_department_trophy_access.sql`, `20261020300000_recognition_personal_awards.sql`, `20261020310000_recognition_ceremony_delivery.sql`, and `20261020320000_recognition_governance.sql` in that order.
- Room7 Webinar W1 stays paused and its unshipped migration numbers must be renumbered after this program; never reuse the four versions above.
- The cabinet renders below the department header/team count and above the department tabs for every authorized viewer, including a visible empty state.
- Authorized department relationships are exactly `department_member`, `workstation_assignee`, `department_head`, `delegated_leadership`, and `workspace_admin`.
- Personal awards default to `private`; only an explicit, audited `company_recognition` classification may expose sanitized company copy.
- Existing KPI computation and ribbon systems remain canonical; do not create a second KPI calculator.
- Existing trophy/major visual timing remains `introMs=1600`, `holdMs=7000`, with 108 deterministic pieces and no autoplay audio.
- Claim-before-display remains the duplicate-prevention boundary; parallel tabs receive a delivery at most once.
- Existing historical department trophies are not mass-replayed because recipient snapshots do not exist. Guaranteed per-recipient delivery begins for achievements created after the delivery migration. History remains complete.
- Existing eligible personal major awards may be backfilled safely because the recipient is unambiguous: rows already present in `employee_recognition_award_seen` become consumed deliveries; eligible unseen rows become pending deliveries.
- Browser code never directly reads or mutates protected achievement, award, delivery, or governance tables; typed RPCs are the browser boundary and RLS remains defense in depth.
- All privileged SQL functions use `SECURITY DEFINER` only where required, `SET search_path = public, pg_temp`, explicit caller authorization, and no execution grant to `anon` or PostgreSQL `PUBLIC`.
- Realtime payloads are refresh signals only; protected DTOs are always refetched or claimed from the server.
- Preview mode creates no awards, deliveries, notifications, seen-state, or governance mutations.
- Accessibility target is WCAG 2.2 AA: keyboard support, visible focus, focus return, reduced motion, complete non-motion fallback, and sufficient contrast.

## Review Focus

1. Department aliases and workstation slugs that differ in spelling or display name must resolve to one canonical department without granting unrelated access; Task 2 adds normalization and E2E fixtures for Marketing, People/HR, Executive, and Administration mappings.
2. Relaxing the legacy monthly-award uniqueness rules must not create two active monthly top performers for one award month or break the current dashboard chip; Task 4 adds migration and compatibility tests.
3. The old department/major seen tables and the new delivery ledger must not replay already-consumed ceremonies; Task 6 adds explicit compatibility/backfill assertions.
4. A claim followed by navigation, renderer failure, or browser close must not produce a duplicate automatic takeover while the permanent shelf remains visible; Tasks 6 and 7 test this lifecycle.
5. Deactivation or department transfer between award creation and sign-in must preserve earned history, block new ineligible delivery creation, and prevent an inactive session from claiming; Task 6 covers all three cases.

---

### Task 1: Establish the Isolated Repair Workspace and Baseline

**Files:**
- Create in repo: `docs/superpowers/specs/2026-10-20-department-trophy-personal-awards-seasonal-celebrations-design.md`
- Create in repo: `docs/superpowers/plans/2026-10-20-trophy-awards-foundation-repair-plan.md`
- No product files changed in this task.

**Interfaces:**
- Produces: isolated branch `fix/trophy-awards-foundation-20261020`, clean baseline SHA, installed dependencies, and committed approved design/plan.

- [ ] **Step 1: Create an isolated worktree from current `origin/main`**

Use `superpowers:using-git-worktrees`. Do not reuse the dirty primary checkout or a prior trophy/celebration worktree.

- [ ] **Step 2: Copy the approved spec and this plan into the repository paths**

Update the spec status to `Approved for implementation`; do not change approved product requirements.

- [ ] **Step 3: Install exact dependencies**

Run: `npm ci`

Expected: exit 0 with the lockfile unchanged.

- [ ] **Step 4: Run the baseline gates**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:supabase
git diff --check
```

Expected: every command exits 0 before feature work begins. If local Supabase is not running, start/reset it and rerun rather than waiving the baseline.

- [ ] **Step 5: Commit only the approved documents**

```bash
git add \
  docs/superpowers/specs/2026-10-20-department-trophy-personal-awards-seasonal-celebrations-design.md \
  docs/superpowers/plans/2026-10-20-trophy-awards-foundation-repair-plan.md
git commit -m "docs: approve trophy and awards repair plan"
```

---

### Task 2: Add Server-Authoritative Department Trophy Access

**Files:**
- Create: `supabase/migrations/20261020290000_recognition_department_trophy_access.sql`
- Create: `scripts/recognition-department-access.contract.test.mjs`
- Create: `scripts/recognition-department-access-e2e.test.mjs`
- Modify: `package.json` to include the E2E suite in `test:supabase`.

**Interfaces:**
- Consumes: `employee_profiles`, `workspace_workstation_assignments`, `workspace_department_leads`, `department_achievements`, `public.is_workspace_admin()`.
- Produces:
  - internal `public.recognition_normalize_department(p_value text) returns text`;
  - internal `public.recognition_department_relationship(p_department text) returns text`;
  - authenticated `public.get_authorized_department_trophy_context(p_department text) returns jsonb`;
  - authenticated `public.list_department_trophy_history(p_department text, p_limit integer default 50) returns table(id uuid, department text, kind text, tier text, title text, description text, earned_at timestamptz)`.

- [ ] **Step 1: Write failing contract tests**

Assert the migration is additive; defines the exact five relationship values; recognizes active department membership, active workstation assignment, `is_head`, active `workspace_department_leads`, and workspace admin; denies inactive/unrelated callers; secures every helper; and returns no protected data before authorization.

- [ ] **Step 2: Write the serialized Supabase E2E suite**

Create fixtures proving:

- profile department member receives `department_member`;
- active matching workstation assignment receives `workstation_assignee` even when `employee_profiles.department` differs;
- active workstation `is_head` receives `department_head`;
- active `workspace_department_leads` row receives `delegated_leadership`;
- workspace admin receives `workspace_admin` but is not inserted as a department member;
- inactive and unrelated users receive no history;
- Marketing, People/HR, Executive, and Administration aliases normalize safely;
- arbitrary partial strings do not match a department.

- [ ] **Step 3: Run RED**

Run:

```bash
node --test scripts/recognition-department-access.contract.test.mjs
node --test --test-concurrency=1 scripts/recognition-department-access-e2e.test.mjs
```

Expected: FAIL because the migration/functions do not exist.

- [ ] **Step 4: Implement the migration**

Requirements:

- canonical comparison is exact after normalization, never substring authorization;
- workstation mapping is explicit (`people` ↔ People/HR, `executive` ↔ Executive/CEO Management, `administration` ↔ Administration, and exact direct mappings for other departments);
- the context DTO contains only `authorized`, `department`, `relationship`, and `achievement_count`;
- history caps `p_limit` to `1..100` and orders newest first;
- revoke direct `authenticated` reads of `department_achievements` and `department_achievement_seen`; browser access is RPC-only while service-role maintenance remains explicit;
- helper functions that do not need browser execution stay revoked from authenticated.

- [ ] **Step 5: Run GREEN and migration sanity**

Run:

```bash
node --test \
  scripts/recognition-department-access.contract.test.mjs \
  scripts/migration-sql-sanity.test.mjs
node --test --test-concurrency=1 scripts/recognition-department-access-e2e.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  supabase/migrations/20261020290000_recognition_department_trophy_access.sql \
  scripts/recognition-department-access.contract.test.mjs \
  scripts/recognition-department-access-e2e.test.mjs \
  package.json
git commit -m "fix(recognition): authorize department trophy cabinets"
```

---

### Task 3: Make the Department Trophy Cabinet Always Visible When Authorized

**Files:**
- Modify: `src/components/DepartmentTrophyCabinet.tsx`
- Modify: `src/modules/DepartmentTeamWorkspace.tsx`
- Modify: `src/department-achievements.css`
- Modify: `src/department-workspace.css`
- Modify: `scripts/department-achievements-ui.test.mjs`
- Create: `scripts/department-trophy-cabinet-access.test.mjs`

**Interfaces:**
- Consumes: `get_authorized_department_trophy_context()` and `list_department_trophy_history()` from Task 2.
- Produces: `DepartmentTrophyCabinet({ department }: { department: string })`, which owns server authorization/loading/error/empty/history states and no longer accepts a browser-calculated `enabled` flag.

- [ ] **Step 1: Extend the UI tests**

Assert:

- `DepartmentTrophyCabinet` appears after `.departmentHero` and before `.departmentTabs`;
- `DepartmentTeamWorkspace` does not calculate `canViewAchievements` from profile role/department;
- the cabinet calls both Task 2 RPCs and never reads `department_achievements` directly;
- authorized zero-history response renders the exact empty copy from the spec;
- unauthorized response renders a neutral access message without a false empty shelf;
- loading, retry, count, featured trophy, shelf history, and stale-request suppression exist;
- mobile CSS provides a scrollable shelf and does not hide the cabinet.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test \
  scripts/department-achievements-ui.test.mjs \
  scripts/department-trophy-cabinet-access.test.mjs
```

Expected: FAIL on the removed `enabled` prop and new server-context behavior.

- [ ] **Step 3: Implement the cabinet repair**

Requirements:

- always render the cabinet shell for a non-empty canonical department while authorization is being resolved;
- fetch context first, then authorized history;
- keep realtime as a debounced refetch signal only;
- invalidate stale requests on department changes/unmount;
- preserve permanent history independently from ceremony delivery;
- retry button refetches context and history;
- no protected department names or counts leak after authorization denial.

- [ ] **Step 4: Run GREEN and responsive core tests**

Run:

```bash
node --test \
  scripts/department-achievements-ui.test.mjs \
  scripts/department-trophy-cabinet-access.test.mjs \
  scripts/responsive-core-modules.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/DepartmentTrophyCabinet.tsx \
  src/modules/DepartmentTeamWorkspace.tsx \
  src/department-achievements.css \
  src/department-workspace.css \
  scripts/department-achievements-ui.test.mjs \
  scripts/department-trophy-cabinet-access.test.mjs
git commit -m "fix(recognition): restore department trophy cabinet UI"
```

---

### Task 4: Establish Private Personal Awards and RPC-Only DTOs

**Files:**
- Create: `supabase/migrations/20261020300000_recognition_personal_awards.sql`
- Create: `scripts/personal-awards-security.contract.test.mjs`
- Create: `scripts/personal-awards-e2e.test.mjs`
- Modify: `package.json`.

**Interfaces:**
- Consumes: `employee_recognition_awards`, `employee_profiles`, current monthly KPI award generation.
- Produces:
  - exact categories `monthly_kpi_excellence`, `annual_kpi_excellence`, `golden_of_week`, `major_project_contribution`, `clean_overdue_record`, `customer_commendation`, `team_commendation`, `service_anniversary`, `training_compliance`, `identity_compliance_milestone`, `other`;
  - exact visibility values `private`, `company_recognition`;
  - authenticated `public.list_my_awards(p_limit integer default 20, p_before timestamptz default null) returns table(award_id uuid, category text, title text, description text, badge_code text, badge_label text, performance_month date, score numeric, awarded_at timestamptz, visibility text)`;
  - authenticated `public.list_company_recognition_awards(p_limit integer default 20, p_before timestamptz default null) returns table(award_id uuid, employee_id uuid, employee_name text, category text, title text, message text, awarded_at timestamptz)`.

- [ ] **Step 1: Write failing migration/security tests**

Assert the migration:

- adds `award_category`, `title`, `description`, `visibility`, `company_title`, `company_message`, `source_kind`, `source_key`, `issued_by`, `issue_reason`, `revoked_at`, `revoked_by`, `revocation_reason`, and `updated_at`;
- backfills existing rows as private monthly KPI awards without changing their score/month data;
- makes `score` and `performance_month` nullable for non-KPI awards while preserving non-null values for monthly KPI generation; manual awards keep `award_month` as the first day of the issued month;
- drops the legacy global `award_month` uniqueness and global one-active index, replacing them with a partial monthly-winner uniqueness rule;
- replaces `refresh_monthly_kpi_award(date)` so it deactivates only active monthly-top-performer rows, never discretionary/personal awards, and continues generating exactly one winner per award month;
- never returns score, overdue counts, or evidence from the company-recognition DTO;
- caller-scopes private awards;
- ultimately removes direct authenticated reads of `employee_recognition_awards` after browser consumers migrate in Task 5.

- [ ] **Step 2: Write serialized E2E tests**

Prove:

- employee sees all own active, non-revoked awards;
- unrelated employee cannot read private awards;
- company-recognition listing returns sanitized copy only;
- monthly generation can still maintain exactly one monthly winner per award month;
- multiple non-monthly awards may exist in the same month;
- pagination is deterministic by `(awarded_at,id)` and clamps limits;
- inactive callers receive no data.

- [ ] **Step 3: Run RED**

Run:

```bash
node --test scripts/personal-awards-security.contract.test.mjs
node --test --test-concurrency=1 scripts/personal-awards-e2e.test.mjs
```

Expected: FAIL because the columns/RPCs do not exist.

- [ ] **Step 4: Implement the migration**

Use `badge_label` as the fallback title and derive existing category from `badge_code`. Keep monthly KPI computation untouched. Add controlled update timestamps and exact indexes described by the tests.

- [ ] **Step 5: Run GREEN**

Run:

```bash
node --test \
  scripts/personal-awards-security.contract.test.mjs \
  scripts/migration-sql-sanity.test.mjs
node --test --test-concurrency=1 scripts/personal-awards-e2e.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  supabase/migrations/20261020300000_recognition_personal_awards.sql \
  scripts/personal-awards-security.contract.test.mjs \
  scripts/personal-awards-e2e.test.mjs \
  package.json
git commit -m "feat(recognition): add private personal award DTOs"
```

---

### Task 5: Add the Dashboard `My Awards` Shelf

**Files:**
- Create: `src/components/MyAwardsShelf.tsx`
- Create: `src/components/MyAwardsHistoryDialog.tsx`
- Create: `src/my-awards.css`
- Modify: `src/modules/PersonalDashboard.tsx`
- Modify: `src/components/Recognition.tsx` only where legacy direct award reads remain.
- Modify: `src/personal-dashboard.css`
- Create: `scripts/my-awards-shelf.test.mjs`
- Modify: `scripts/recognition.test.mjs`.

**Interfaces:**
- Consumes: `list_my_awards()` and `list_company_recognition_awards()` from Task 4.
- Produces:
  - `MyAwardsShelf({ onOpenHistory? }: { onOpenHistory?: () => void })`;
  - `MyAwardsHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void })`.

- [ ] **Step 1: Write failing UI/privacy tests**

Assert:

- `PersonalDashboard` mounts `MyAwardsShelf` after KPI/performance content and before task/calendar/update content;
- the shelf uses only `list_my_awards`, never direct `employee_recognition_awards` reads;
- the latest awards render as an accessible horizontal shelf with total, empty state, and `View all awards`;
- history dialog is keyboard operable, focus-managed, paginated, and private;
- company recognition uses sanitized RPC data;
- mobile CSS supports horizontal scrolling without hiding text or controls.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test \
  scripts/my-awards-shelf.test.mjs \
  scripts/recognition.test.mjs
```

Expected: FAIL because the shelf and RPC consumers do not exist.

- [ ] **Step 3: Implement the shelf and migrate consumers**

Requirements:

- no score appears on public/company cards unless the recipient views their own private detail;
- award category labels are humanized from the exact enum;
- revoked awards never render;
- history remains visible after ceremony consumption;
- RPC errors show a compact retry state and never block Dashboard;
- remove remaining browser direct reads that would violate Task 4 privacy.

- [ ] **Step 4: Run GREEN and dashboard tests**

Run:

```bash
node --test \
  scripts/my-awards-shelf.test.mjs \
  scripts/recognition.test.mjs \
  scripts/responsive-shell.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/MyAwardsShelf.tsx \
  src/components/MyAwardsHistoryDialog.tsx \
  src/my-awards.css \
  src/modules/PersonalDashboard.tsx \
  src/components/Recognition.tsx \
  src/personal-dashboard.css \
  scripts/my-awards-shelf.test.mjs \
  scripts/recognition.test.mjs
git commit -m "feat(recognition): add private My Awards shelf"
```

---

### Task 6: Add Durable Per-Recipient Ceremony Delivery

**Files:**
- Create: `supabase/migrations/20261020310000_recognition_ceremony_delivery.sql`
- Create: `scripts/recognition-ceremony-delivery.contract.test.mjs`
- Create: `scripts/recognition-ceremony-delivery-e2e.test.mjs`
- Modify: `package.json`.

**Interfaces:**
- Consumes: `department_achievements`, `department_achievement_seen`, `employee_recognition_awards`, `employee_recognition_award_seen`, Task 4 visibility/category fields.
- Produces:
  - table `recognition_ceremony_deliveries` with the exact spec states and two partial unique identities for `source_id` and `source_key`;
  - internal `public.materialize_department_achievement_deliveries(p_achievement_id uuid) returns integer`;
  - internal `public.materialize_personal_award_delivery(p_award_id uuid) returns uuid`;
  - authenticated `public.claim_next_recognition_ceremony() returns jsonb`;
  - authenticated `public.mark_recognition_ceremony_presented(p_delivery_id uuid) returns void`;
  - authenticated `public.mark_recognition_ceremony_dismissed(p_delivery_id uuid) returns void`.

- [ ] **Step 1: Write failing contract tests**

Assert exact source kinds, audience types, states, timestamps, recipient ownership, indexes, trigger hooks, `FOR UPDATE SKIP LOCKED`, redacted DTOs, no arbitrary recipient parameter, and revoked direct browser writes.

- [ ] **Step 2: Write serialized E2E coverage**

Prove:

- a new department achievement snapshots every active profile department member exactly once;
- workstation viewers who are not department members can view the cabinet but do not receive the department ceremony;
- inactive employees receive no new delivery;
- a transfer after creation does not remove the delivery;
- a new member receives history but no old delivery;
- parallel claims produce one result;
- offline pending delivery claims on next authenticated session;
- personal award delivery targets only the award employee;
- company recognition may create sanitized company deliveries without copying private score/evidence;
- old department history is not mass-replayed;
- personal major award backfill marks old seen rows consumed and unseen eligible recipient rows pending;
- presented/dismissed transitions require the recipient and preserve shelf/history;
- inactive callers cannot claim.

- [ ] **Step 3: Run RED**

Run:

```bash
node --test scripts/recognition-ceremony-delivery.contract.test.mjs
node --test --test-concurrency=1 scripts/recognition-ceremony-delivery-e2e.test.mjs
```

Expected: FAIL because the ledger/functions do not exist.

- [ ] **Step 4: Implement the migration**

Queue ordering is `priority desc, eligible_at asc, created_at asc, id asc`. Claim expires stale pending rows before selecting. Existing legacy seen tables remain for audit/compatibility but new post-migration automatic ceremonies use the delivery ledger.

- [ ] **Step 5: Run GREEN**

Run:

```bash
node --test \
  scripts/recognition-ceremony-delivery.contract.test.mjs \
  scripts/migration-sql-sanity.test.mjs
node --test --test-concurrency=1 scripts/recognition-ceremony-delivery-e2e.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  supabase/migrations/20261020310000_recognition_ceremony_delivery.sql \
  scripts/recognition-ceremony-delivery.contract.test.mjs \
  scripts/recognition-ceremony-delivery-e2e.test.mjs \
  package.json
git commit -m "feat(recognition): add durable ceremony delivery"
```

---

### Task 7: Centralize Ceremony Queue and Cut Over Department/Personal Ceremonies

**Files:**
- Create: `src/celebrations/types.ts`
- Create: `src/celebrations/api.ts`
- Create: `src/celebrations/CelebrationBlockerContext.tsx`
- Create: `src/celebrations/useRecognitionCeremonyQueue.ts`
- Create: `src/components/RecognitionCeremonyHost.tsx`
- Create: `src/components/celebrations/DepartmentTrophyScene.tsx`
- Create: `src/components/celebrations/PersonalAwardScene.tsx`
- Create: `src/components/celebrations/CompanyMilestoneScene.tsx`
- Modify: `src/components/PremiumCelebrationStage.tsx`
- Modify: `src/components/Recognition.tsx`
- Modify: `src/App.tsx`
- Create: `scripts/recognition-ceremony-queue.test.mjs`
- Modify: `scripts/department-achievement-once.test.mjs`
- Modify: `scripts/major-recognition-ceremony.test.mjs`
- Modify: `scripts/premium-celebration-stage.test.mjs`.

**Interfaces:**
- Consumes: Task 6 claim/presentation RPCs and existing `PremiumCelebrationStage`.
- Produces:
  - `CeremonyPresentation` discriminated union for `department_achievement | personal_award | company_recognition | company_milestone`;
  - `CelebrationBlockerProvider`, `useCelebrationBlocker(reason, active)`, and `useCelebrationIsBlocked()` as the explicit protected-surface contract;
  - `useRecognitionCeremonyQueue()` with `current`, `claimNext()`, `markPresented()`, `dismiss()`, `blocked`, and `pendingSessionCount`;
  - `RecognitionCeremonyHost`, mounted once in the authenticated shell.

- [ ] **Step 1: Write failing queue/cutover tests**

Assert:

- only one stage mounts;
- claims happen before rendering;
- `mark_presented` runs only after the scene/stage reports a successful mount;
- dismissal records the delivery but never removes shelf/history;
- at most two automatic ceremonies present in one app session;
- document-hidden or an active blocker registered through `CelebrationBlockerProvider` defers claiming;
- sign-out clears memory state;
- reconnect/visibility regain retries pending claim;
- existing department/major components no longer call legacy unseen/seen RPCs;
- trophy/major timings and 108-piece behavior remain exact;
- renderer failure leaves the claimed delivery consumed and shows a non-blocking fallback card.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test \
  scripts/recognition-ceremony-queue.test.mjs \
  scripts/department-achievement-once.test.mjs \
  scripts/major-recognition-ceremony.test.mjs \
  scripts/premium-celebration-stage.test.mjs
```

Expected: FAIL because the central queue/host does not exist.

- [ ] **Step 3: Implement the queue and focused scenes**

Keep `PremiumCelebrationStage` responsible for modal/focus/timing/dismissal and scene components responsible only for sanitized visuals/copy. Use `sessionStorage` keyed by the authenticated user/session for the two-takeover cap, and clear it on sign-out; do not use persistent `localStorage`. Do not integrate Birthday or seasonal kinds in this task; Task T5 adds them through the same union.

- [ ] **Step 4: Run GREEN and existing celebration tests**

Run:

```bash
node --test \
  scripts/recognition-ceremony-queue.test.mjs \
  scripts/department-achievement-once.test.mjs \
  scripts/department-achievements-ui.test.mjs \
  scripts/major-recognition-ceremony.test.mjs \
  scripts/premium-celebration-stage.test.mjs \
  scripts/recognition.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/celebrations \
  src/components/RecognitionCeremonyHost.tsx \
  src/components/celebrations \
  src/components/PremiumCelebrationStage.tsx \
  src/components/Recognition.tsx \
  src/App.tsx \
  scripts/recognition-ceremony-queue.test.mjs \
  scripts/department-achievement-once.test.mjs \
  scripts/major-recognition-ceremony.test.mjs \
  scripts/premium-celebration-stage.test.mjs
git commit -m "refactor(recognition): centralize one-time ceremony delivery"
```

---

### Task 8: Add Administration Preview, Delivery Health, and Award Governance

**Files:**
- Create: `supabase/migrations/20261020320000_recognition_governance.sql`
- Create: `src/modules/RecognitionCelebrationsAdmin.tsx`
- Create: `src/recognition-admin.css`
- Modify: `src/modules/AdministrationControlPlane.tsx`
- Create: `scripts/recognition-governance.contract.test.mjs`
- Create: `scripts/recognition-governance-e2e.test.mjs`
- Create: `scripts/recognition-admin-ui.test.mjs`
- Modify: `package.json`.

**Interfaces:**
- Consumes: Tasks 4–7 awards, deliveries, scenes, and queue types.
- Produces:
  - internal `public.can_govern_recognition() returns boolean` using active People/Administration workstation or workspace-admin authority;
  - `public.list_recognition_delivery_health(p_from timestamptz default null, p_to timestamptz default null) returns table(...)`;
  - `public.reissue_recognition_ceremony(p_delivery_id uuid, p_reason text, p_request_id uuid default gen_random_uuid()) returns uuid`;
  - `public.issue_employee_award(p_payload jsonb, p_request_id uuid default gen_random_uuid()) returns uuid`;
  - `public.change_employee_award_visibility(p_award_id uuid, p_visibility text, p_reason text, p_request_id uuid default gen_random_uuid()) returns void`;
  - `public.revoke_employee_award(p_award_id uuid, p_reason text, p_request_id uuid default gen_random_uuid()) returns void`;
  - `public.preview_recognition_ceremony(p_theme text, p_payload jsonb) returns jsonb` with validation/sanitization and no writes;
  - append-only `recognition_governance_audit_events`.

- [ ] **Step 1: Write failing security and UI tests**

Assert:

- only authorized People/Administration/workspace-admin callers govern recognition;
- inactive users and ordinary employees are denied;
- every mutation requires a non-empty reason where specified and writes one idempotent audit event;
- reissue resets the governed delivery with `revision+1` while preserving prior timestamps in audit metadata;
- private-to-company publication requires explicit sanitized company title/message and never exposes score/evidence;
- preview validates supported themes, returns sanitized sample DTOs, and performs no database writes;
- Administration adds a `Recognition & Celebrations` tab and imports the real production host/scenes rather than duplicate mock markup;
- preview supports desktop/tablet/mobile and normal/reduced motion;
- delivery health is aggregate and does not expose private award payloads.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test \
  scripts/recognition-governance.contract.test.mjs \
  scripts/recognition-admin-ui.test.mjs
node --test --test-concurrency=1 scripts/recognition-governance-e2e.test.mjs
```

Expected: FAIL because governance migration/UI do not exist.

- [ ] **Step 3: Implement the migration and Administration module**

The browser must use only RPCs. Preview runs with local sample payload after server validation and sets no delivery state. Governance lists use employee directory lookup through approved RPCs, not unrestricted profile table scans from the new module. Issuing an award calls the Task 6 personal-delivery materializer in the same transaction. Changing visibility to `company_recognition` snapshots active employees into sanitized company deliveries exactly once; reverting to `private` revokes only unclaimed company deliveries. Revocation marks the award revoked, revokes unclaimed deliveries, and preserves presented history plus audit evidence.

- [ ] **Step 4: Run GREEN**

Run:

```bash
node --test \
  scripts/recognition-governance.contract.test.mjs \
  scripts/recognition-admin-ui.test.mjs \
  scripts/admin-chat-access.test.mjs \
  scripts/manager-access.test.mjs
node --test --test-concurrency=1 scripts/recognition-governance-e2e.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  supabase/migrations/20261020320000_recognition_governance.sql \
  src/modules/RecognitionCelebrationsAdmin.tsx \
  src/recognition-admin.css \
  src/modules/AdministrationControlPlane.tsx \
  scripts/recognition-governance.contract.test.mjs \
  scripts/recognition-governance-e2e.test.mjs \
  scripts/recognition-admin-ui.test.mjs \
  package.json
git commit -m "feat(recognition): add governed celebration administration"
```

---

### Task 9: Verify the Complete T1–T4 Foundation and Prepare the PR

**Files:**
- Modify only files required by failures found through TDD.
- Do not add unrelated cleanup.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: merge-ready T1–T4 branch with fresh evidence.

- [ ] **Step 1: Run focused recognition suites**

```bash
node --test \
  scripts/recognition-department-access.contract.test.mjs \
  scripts/department-achievements-ui.test.mjs \
  scripts/department-trophy-cabinet-access.test.mjs \
  scripts/personal-awards-security.contract.test.mjs \
  scripts/my-awards-shelf.test.mjs \
  scripts/recognition-ceremony-delivery.contract.test.mjs \
  scripts/recognition-ceremony-queue.test.mjs \
  scripts/recognition-governance.contract.test.mjs \
  scripts/recognition-admin-ui.test.mjs \
  scripts/premium-celebration-stage.test.mjs \
  scripts/recognition.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run complete application gates**

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all exit 0. Existing non-blocking chunk-size warnings must be reported, not misrepresented as failures.

- [ ] **Step 3: Run complete local Supabase gates**

```bash
supabase db reset
npm run test:supabase
```

Expected: all existing and new serialized suites pass.

- [ ] **Step 4: Run production migration dry-run only**

```bash
supabase link --project-ref fkkxcivxnwshahnbatnp
supabase db push --dry-run
```

Expected: only the four T1–T4 migrations are pending, assuming production is otherwise current. Do not run the real push before PR merge approval.

- [ ] **Step 5: Perform visual QA**

Verify desktop, tablet, and mobile:

- cabinet exact placement;
- authorized empty, populated, loading, retry, and denied states;
- My Awards empty/populated/history states;
- one-at-a-time ceremony queue;
- reduced motion;
- Administration preview writes nothing.

- [ ] **Step 6: Commit verified follow-up fixes if any**

Each fix requires a failing regression test before code. Commit with a focused message.

- [ ] **Step 7: Request whole-branch review and use `superpowers:finishing-a-development-branch`**

The T1–T4 PR must merge and its migrations must be deployed/verified before the T5 seasonal branch is created.

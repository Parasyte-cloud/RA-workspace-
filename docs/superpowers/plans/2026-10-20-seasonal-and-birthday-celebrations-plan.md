# Christmas, New Year and Enhanced Birthday Celebrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add governed, durable Christmas and New Year company ceremonies plus a richer cross-device Birthday ceremony, using the merged recognition-delivery ledger and shared premium stage without slowing normal RA-Workspace startup.

**Architecture:** Add a seasonal campaign state machine and Vault-authenticated materializer, focused lazy-loaded scene components, first-party optimized assets, device-aware motion profiles, and Administration scheduling/preview extensions. Birthday reuses the existing birthday source/wish system and creates one annual delivery through the central ceremony ledger.

**Tech Stack:** React 19, TypeScript, CSS/canvas, optimized WebP/AVIF assets, Supabase PostgreSQL/RLS/RPC/Realtime, Supabase Edge Functions, hardened Vault-backed cron dispatch, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-20-department-trophy-personal-awards-seasonal-celebrations-design.md`

## Global Constraints

- This plan begins only after the T1–T4 foundation PR is merged and migrations `20261020290000` through `20261020320000` are verified Local+Remote.
- Use migrations `20261020330000_recognition_seasonal_campaigns.sql` and `20261020340000_recognition_birthday_delivery.sql`; do not edit earlier migrations.
- Campaign types are exactly `christmas`, `new_year`; initial audience scope is exactly `company`.
- Campaign states are exactly `draft`, `scheduled`, `published`, `materialized`, `cancelled`, `completed` with transitions from the approved spec.
- Seasonal greetings never affect KPI calculations, award totals, rankings, or `My Awards`.
- Christmas and New Year use `seasonal_max`; full profile has 180–220 deterministic elements, balanced has 110–140.
- Birthday uses 120–150 elements, one durable delivery per employee/calendar year, and never displays or infers age/birth year.
- Christmas auto-close is 12 seconds; New Year auto-close is 11 seconds; enhanced Birthday auto-close is 9 seconds.
- New Year countdown appears only inside the server-authorized live-midnight window; delayed login uses `Welcome to <year>` and no fake countdown.
- Seasonal assets are first-party, CSP-compatible, lazy-loaded only for a pending matching delivery, with mobile target `<=1.5 MB`, desktop target `<=3 MB`, static fallback `<=250 KB`.
- No arbitrary uploaded HTML, JavaScript, CSS, fonts, remote trackers, or third-party runtime asset hosts.
- No autoplay audio.
- Reduced-motion mode suppresses sleigh flight, countdown motion, fireworks, heavy ribbons, and particles while preserving all copy/actions.
- At most two automatic takeovers appear per application session; protected surfaces defer without discarding pending delivery.
- Scheduled materialization uses the Phase 2B Vault-backed cron-dispatch pattern, the exact cron job name `ridearrivo-recognition-seasonal-dispatch`, the schedule `* * * * *`, and never embeds a service-role credential in cron SQL.

## Review Focus

1. Browser clock/timezone manipulation must not select the New Year live countdown outside the server window; Tasks 2 and 5 test server-selected variants.
2. Seasonal campaign retries and cron overlap must never duplicate recipients; Task 2 includes row locking, request idempotency, and concurrent E2E coverage.
3. A low-memory/save-data device or failed Santa asset must still display complete copy and only mark presented after a static/balanced scene mounts; Tasks 3 and 4 test downgrade/fallback lifecycle.
4. Birthday delivery must remain once-per-year across devices without exposing date of birth, age, or year and without breaking coworker wishes; Task 6 covers all paths.
5. A pending seasonal takeover must not interrupt Room7, a live Support call, payment flow, or unsaved critical form and must remain claimable later; Task 7 exercises each blocker.

---

### Task 1: Establish the Seasonal Worktree from the Merged Foundation

**Files:**
- Create in repo: `docs/superpowers/plans/2026-10-20-seasonal-and-birthday-celebrations-plan.md`
- No product files changed in this task.

**Interfaces:**
- Consumes: merged T1–T4 RPCs, delivery ledger, queue, Administration module, and scene union.
- Produces: isolated branch `feat/seasonal-celebrations-20261020` with green baseline.

- [ ] **Step 1: Create an isolated worktree from current `origin/main` after T1–T4 merge**

Use `superpowers:using-git-worktrees` and verify migration history contains `20261020320000` locally and remotely.

- [ ] **Step 2: Copy this approved plan into the repository**

- [ ] **Step 3: Run baseline**

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:supabase
git diff --check
```

Expected: all pass before T5 work.

- [ ] **Step 4: Commit the plan**

```bash
git add docs/superpowers/plans/2026-10-20-seasonal-and-birthday-celebrations-plan.md
git commit -m "docs: plan seasonal recognition ceremonies"
```

---

### Task 2: Add Seasonal Campaign Governance and Idempotent Materialization

**Files:**
- Create: `supabase/migrations/20261020330000_recognition_seasonal_campaigns.sql`
- Create: `supabase/functions/recognition-seasonal-dispatch/index.ts`
- Modify: `supabase/config.toml`
- Create: `scripts/seasonal-campaigns.contract.test.mjs`
- Create: `scripts/seasonal-campaigns-e2e.test.mjs`
- Create: `scripts/seasonal-dispatch-security.test.mjs`
- Modify: `package.json`.

**Interfaces:**
- Consumes: `recognition_ceremony_deliveries`, `recognition_governance_audit_events`, `can_govern_recognition()`, hardened `cron_dispatch_secret` convention.
- Produces:
  - table `recognition_seasonal_campaigns` with exact spec columns/state flow;
  - `public.list_recognition_seasonal_campaigns(p_year integer default null) returns table(...)`;
  - `public.save_recognition_seasonal_campaign(p_payload jsonb, p_request_id uuid default gen_random_uuid()) returns uuid`;
  - `public.publish_recognition_seasonal_campaign(p_campaign_id uuid, p_expected_updated_at timestamptz, p_request_id uuid default gen_random_uuid()) returns void`;
  - `public.cancel_recognition_seasonal_campaign(p_campaign_id uuid, p_reason text, p_request_id uuid default gen_random_uuid()) returns void`;
  - internal/service `public.materialize_due_recognition_seasonal_campaigns(p_now timestamptz default now()) returns table(campaign_id uuid, recipient_count integer)`;
  - authenticated caller-scoped `public.ensure_my_due_seasonal_deliveries() returns integer`, called by the central claim path as a missed-cron fallback without accepting a user ID;
  - Edge Function `recognition-seasonal-dispatch`, configured with `verify_jwt=false` and authenticated only by `Authorization: Bearer <CRON_DISPATCH_SECRET>`.

- [ ] **Step 1: Write failing contract/security tests**

Assert exact states/types, one active campaign per type/year/audience, IANA timezone validation, UTC windows, plain-text length limits, row locking, materialization uniqueness, immutable audience/source after materialization, no service-role secret in cron text, no JWT/browser access to the dispatch function, and redacted list DTOs.

- [ ] **Step 2: Write serialized E2E tests**

Prove:

- authorized admin creates/updates/schedules/publishes; ordinary employee cannot;
- invalid timezone/window/live-window/state transitions fail;
- two concurrent materializers create exactly one delivery per active employee;
- inactive employees receive none;
- duplicate dispatch/retry returns same counts without new rows;
- cancellation before materialization creates none;
- emergency cancellation after materialization revokes unclaimed deliveries and preserves presented history;
- live/delayed New Year variant is selected from `p_now` and campaign windows, not browser input;
- expired deliveries do not auto-present.

- [ ] **Step 3: Run RED**

```bash
node --test \
  scripts/seasonal-campaigns.contract.test.mjs \
  scripts/seasonal-dispatch-security.test.mjs
node --test --test-concurrency=1 scripts/seasonal-campaigns-e2e.test.mjs
```

Expected: FAIL because the migration/function do not exist.

- [ ] **Step 4: Implement migration and Edge Function**

The dispatch endpoint accepts no campaign/body override; it invokes the due-materializer using server time after constant-time comparison with `CRON_DISPATCH_SECRET`. The due-materializer atomically promotes enabled `scheduled` campaigns to `published` when `starts_at <= p_now < ends_at`, then materializes recipients; it marks elapsed materialized campaigns `completed` and expires pending deliveries. The caller-scoped fallback inserts only `auth.uid()` for due campaigns and never changes campaign governance state. Cron SQL reads Vault secret `cron_dispatch_secret` and sends `Authorization: Bearer <secret>` without logging it.

- [ ] **Step 5: Run GREEN**

```bash
node --test \
  scripts/seasonal-campaigns.contract.test.mjs \
  scripts/seasonal-dispatch-security.test.mjs \
  scripts/migration-sql-sanity.test.mjs
node --test --test-concurrency=1 scripts/seasonal-campaigns-e2e.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  supabase/migrations/20261020330000_recognition_seasonal_campaigns.sql \
  supabase/functions/recognition-seasonal-dispatch/index.ts \
  supabase/config.toml \
  scripts/seasonal-campaigns.contract.test.mjs \
  scripts/seasonal-campaigns-e2e.test.mjs \
  scripts/seasonal-dispatch-security.test.mjs \
  package.json
git commit -m "feat(recognition): add seasonal campaign governance"
```

---

### Task 3: Add the Lazy Scene Architecture and Motion Profiles

**Files:**
- Create: `src/components/celebrations/SeasonalParticleField.tsx`
- Create: `src/components/celebrations/useCelebrationMotionProfile.ts`
- Create: `src/components/celebrations/SeasonalStaticFallback.tsx`
- Create: `src/celebrations/seasonalAssets.ts`
- Modify: `src/celebrations/types.ts`
- Modify: `src/components/RecognitionCeremonyHost.tsx`
- Modify: `src/components/PremiumCelebrationStage.tsx`
- Create: `src/seasonal-celebrations.css`
- Create: `scripts/seasonal-scene-architecture.test.mjs`
- Modify: `vite.config.ts` to assign stable lazy chunk names for Christmas, New Year, and Birthday scene modules so build tests can verify they are absent from the normal entry chunk.

**Interfaces:**
- Produces `CelebrationMotionProfile = 'full' | 'balanced' | 'reduced' | 'static'`.
- Produces `useCelebrationMotionProfile(): { profile: CelebrationMotionProfile; reason: string }`.
- Extends `CeremonyPresentation` with `seasonal_campaign` and `birthday` variants.
- Produces lazy scene loaders so seasonal code/assets are absent from the normal authenticated entry chunk.

- [ ] **Step 1: Write failing architecture tests**

Assert feature detection for reduced motion, `saveData`, device memory, static fallback, deterministic element helpers, no autoplay APIs, dynamic imports for Christmas/New Year/Birthday, and no direct seasonal imports from the app entry.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/seasonal-scene-architecture.test.mjs`

Expected: FAIL because the scene architecture does not exist.

- [ ] **Step 3: Implement the shared seasonal primitives**

Use deterministic index-derived geometry. `requestAnimationFrame` health may downgrade full to balanced/static but must never upgrade reduced motion. Scene loader errors return `SeasonalStaticFallback` and invoke the stage-mounted callback only after fallback content is visible.

- [ ] **Step 4: Run GREEN and build chunk inspection**

```bash
node --test scripts/seasonal-scene-architecture.test.mjs
npm run build
```

Expected: test passes; build succeeds; seasonal chunks are lazy and the normal entry chunk does not include scene asset paths.

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/celebrations/SeasonalParticleField.tsx \
  src/components/celebrations/useCelebrationMotionProfile.ts \
  src/components/celebrations/SeasonalStaticFallback.tsx \
  src/celebrations/seasonalAssets.ts \
  src/celebrations/types.ts \
  src/components/RecognitionCeremonyHost.tsx \
  src/components/PremiumCelebrationStage.tsx \
  src/seasonal-celebrations.css \
  scripts/seasonal-scene-architecture.test.mjs \
  vite.config.ts
git commit -m "feat(recognition): add lazy seasonal scene architecture"
```

---

### Task 4: Build the Christmas Ceremony and Vetted Asset Package

**Files:**
- Create: `src/components/celebrations/ChristmasCelebrationScene.tsx`
- Create: `public/celebrations/christmas/santa-sleigh-full.webp`
- Create: `public/celebrations/christmas/santa-sleigh-balanced.webp`
- Create: `public/celebrations/christmas/santa-sleigh-static.webp`
- Create: `public/celebrations/christmas/asset-manifest.json`
- Modify: `src/celebrations/seasonalAssets.ts`
- Modify: `src/seasonal-celebrations.css`
- Create: `scripts/christmas-celebration.test.mjs`
- Create: `scripts/seasonal-asset-budget.test.mjs`

**Interfaces:**
- Consumes: Task 3 motion profile/particles/fallback.
- Produces `ChristmasCelebrationScene({ presentation, profile, onReady, onAssetError })`.

- [ ] **Step 1: Write failing scene/asset tests**

Assert:

- `seasonal_max`, 12-second stage configuration, full 180–220 and balanced 110–140 deterministic elements;
- Santa/reindeer sleigh pass, gift release, ribbon burst, snow/ornament/star layers, greeting reveal;
- all three first-party assets exist, use allowed MIME/paths, meet size budgets, and contain no remote runtime URL;
- reduced/static profiles preserve complete text without sleigh motion;
- no rapid flash or autoplay-audio path.

- [ ] **Step 2: Run RED**

```bash
node --test \
  scripts/christmas-celebration.test.mjs \
  scripts/seasonal-asset-budget.test.mjs
```

Expected: FAIL because scene/assets do not exist.

- [ ] **Step 3: Produce and approve the first-party visual assets**

Create a realistic, premium Santa-on-reindeer-sleigh sequence with no text/logo baked into the scene. Optimize variants to the approved budgets and document the source-generation prompt/asset manifest in `public/celebrations/christmas/asset-manifest.json` without including font files.

- [ ] **Step 4: Implement the Christmas scene**

The asset is decorative (`alt=""`/aria-hidden); essential greeting remains semantic HTML. Gift/ribbon/particle motion uses CSS/canvas and deterministic geometry. Asset failure immediately selects the static card.

- [ ] **Step 5: Run GREEN and visual/performance QA**

```bash
node --test \
  scripts/christmas-celebration.test.mjs \
  scripts/seasonal-asset-budget.test.mjs \
  scripts/seasonal-scene-architecture.test.mjs
npm run build
```

Expected: all pass; asset budgets hold.

- [ ] **Step 6: Commit**

```bash
git add \
  src/components/celebrations/ChristmasCelebrationScene.tsx \
  public/celebrations/christmas \
  src/celebrations/seasonalAssets.ts \
  src/seasonal-celebrations.css \
  scripts/christmas-celebration.test.mjs \
  scripts/seasonal-asset-budget.test.mjs
git commit -m "feat(recognition): add premium Christmas ceremony"
```

---

### Task 5: Build the New Year Live and Delayed Variants

**Files:**
- Create: `src/components/celebrations/NewYearCelebrationScene.tsx`
- Modify: `src/seasonal-celebrations.css`
- Create: `scripts/new-year-celebration.test.mjs`

**Interfaces:**
- Consumes: server-selected `variant: 'live_midnight' | 'delayed'` from Task 2 and Task 3 primitives.
- Produces `NewYearCelebrationScene({ presentation, profile, onReady })`.

- [ ] **Step 1: Write failing scene tests**

Assert `seasonal_max`, 11-second timing, exact full/balanced ranges, midnight-blue/gold/silver presentation, live-only `3 · 2 · 1`, delayed `Welcome to <year>`, safe fireworks/light blooms, static/reduced fallback, and no client-side variant calculation.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/new-year-celebration.test.mjs`

Expected: FAIL because the scene does not exist.

- [ ] **Step 3: Implement the scene**

Use semantic year/greeting text. Fireworks are opacity/scale light blooms with no rapid high-contrast flashing. Delayed variant never renders countdown markup.

- [ ] **Step 4: Run GREEN**

```bash
node --test \
  scripts/new-year-celebration.test.mjs \
  scripts/seasonal-scene-architecture.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/celebrations/NewYearCelebrationScene.tsx \
  src/seasonal-celebrations.css \
  scripts/new-year-celebration.test.mjs
git commit -m "feat(recognition): add premium New Year ceremony"
```

---

### Task 6: Upgrade Birthday to Durable, Personalized Annual Delivery

**Files:**
- Create: `supabase/migrations/20261020340000_recognition_birthday_delivery.sql`
- Create: `src/components/celebrations/BirthdayCelebrationScene.tsx`
- Modify: `src/modules/BirthdayCelebration.tsx`
- Modify: `src/birthday.css`
- Modify: `src/components/RecognitionCeremonyHost.tsx`
- Modify: `src/celebrations/types.ts`
- Modify: `scripts/birthdays.test.mjs`
- Create: `scripts/birthday-delivery-e2e.test.mjs`
- Modify: `package.json`.

**Interfaces:**
- Consumes: existing `get_birthdays_today`, `get_my_birthday_wishes`, `send_birthday_wish`, and the merged T1–T4 central delivery ledger/queue.
- Produces deterministic delivery key `birthday:<employee-id>:<calendar-year>` and `BirthdayCelebrationScene({ presentation, profile, onReady })`.

- [ ] **Step 1: Extend static and E2E tests**

Assert:

- 9-second `birthday` stage and 120–150 elements;
- balloons/ribbons from both lower corners, gifts/stars/confetti, photo/initials medallion, cake/candle motif, personalized copy;
- no age/birth year/private contact data in DTO or DOM;
- one annual delivery across parallel tabs/devices;
- the legacy localStorage automatic-seen key is removed;
- coworker cards, quick wishes, custom wish, hide, and polling remain;
- user-triggered replay does not create/claim a delivery.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/birthdays.test.mjs
node --test --test-concurrency=1 scripts/birthday-delivery-e2e.test.mjs
```

Expected: FAIL on durable delivery and new scene expectations.

- [ ] **Step 3: Implement birthday materialization and scene integration**

Create `20261020340000_recognition_birthday_delivery.sql` with an idempotent trigger on `birthday_greetings_sent` plus a caller-scoped safety helper invoked by `claim_next_recognition_ceremony()`. Both paths create the same `birthday:<employee-id>:<calendar-year>` identity and never return date of birth. Keep wish behavior outside the automatic takeover so it remains after close.

- [ ] **Step 4: Run GREEN**

```bash
node --test \
  scripts/birthdays.test.mjs \
  scripts/seasonal-scene-architecture.test.mjs
node --test --test-concurrency=1 scripts/birthday-delivery-e2e.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/celebrations/BirthdayCelebrationScene.tsx \
  src/modules/BirthdayCelebration.tsx \
  src/birthday.css \
  src/components/RecognitionCeremonyHost.tsx \
  src/celebrations/types.ts \
  scripts/birthdays.test.mjs \
  scripts/birthday-delivery-e2e.test.mjs \
  package.json \
  supabase/migrations/20261020340000_recognition_birthday_delivery.sql
git commit -m "feat(recognition): add durable enhanced birthday ceremony"
```

---

### Task 7: Enforce Safe Presentation and Protected-Surface Deferral

**Files:**
- Modify: `src/celebrations/CelebrationBlockerContext.tsx`
- Modify: `src/celebrations/useRecognitionCeremonyQueue.ts`
- Modify: `src/components/RecognitionCeremonyHost.tsx`
- Modify: `src/modules/RoomMeeting.tsx`
- Modify: `src/modules/SupportSoftphone.tsx`
- Modify: `src/modules/SupportAssistedBookingPanel.tsx`
- Modify: `src/modules/BlogStudio.tsx`
- Modify: `src/modules/LetterheadStudio.tsx`
- Modify: `src/modules/SheetEditor.tsx`
- Create: `scripts/celebration-protected-surfaces.test.mjs`
- Modify: `scripts/recognition-ceremony-queue.test.mjs`.

**Interfaces:**
- Consumes the T1–T4 `CelebrationBlockerProvider` and instruments `useCelebrationBlocker(reason: 'room7_live' | 'support_call' | 'payment_flow' | 'critical_unsaved_form', active: boolean)` at the exact protected surfaces.
- Queue claims only when blocker count is zero and the document is visible.

- [ ] **Step 1: Write failing blocker/queue tests**

Assert each protected surface registers/unregisters without stale blockers; pending deliveries are not claimed while blocked; visibility restoration retries; two-per-session cap remains; queued seasonal/birthday deliveries remain pending and ordered after unblock; sign-out resets blocker/queue state.

- [ ] **Step 2: Run RED**

```bash
node --test \
  scripts/celebration-protected-surfaces.test.mjs \
  scripts/recognition-ceremony-queue.test.mjs
```

Expected: FAIL because the context/instrumentation does not exist.

- [ ] **Step 3: Implement provider and minimal surface instrumentation**

Register blockers from explicit state only: RoomMeeting while a meeting is mounted/live; SupportSoftphone while `active` is true; SupportAssistedBookingPanel while its submit/payment-link operation is in progress; BlogStudio, LetterheadStudio, and SheetEditor while their existing dirty/unsaved state is true. Do not infer blockers from CSS selectors or text.

- [ ] **Step 4: Run GREEN and affected surface tests**

Run:

```bash
node --test \
  scripts/celebration-protected-surfaces.test.mjs \
  scripts/recognition-ceremony-queue.test.mjs \
  scripts/room7-responsive.test.mjs \
  scripts/support-core.test.mjs \
  scripts/support-assisted-booking-workstation-contract.mjs \
  scripts/blog-studio.test.mjs \
  scripts/letterhead-rc.test.mjs \
  scripts/finance-sheets.test.mjs \
  scripts/responsive-core-modules.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/celebrations/CelebrationBlockerContext.tsx \
  src/celebrations/useRecognitionCeremonyQueue.ts \
  src/components/RecognitionCeremonyHost.tsx \
  src/modules/RoomMeeting.tsx \
  src/modules/SupportSoftphone.tsx \
  src/modules/SupportAssistedBookingPanel.tsx \
  src/modules/BlogStudio.tsx \
  src/modules/LetterheadStudio.tsx \
  src/modules/SheetEditor.tsx \
  scripts/celebration-protected-surfaces.test.mjs \
  scripts/recognition-ceremony-queue.test.mjs
git commit -m "feat(recognition): defer ceremonies on protected surfaces"
```

---

### Task 8: Extend Administration with Seasonal Scheduler and Full Preview Variants

**Files:**
- Modify: `src/modules/RecognitionCelebrationsAdmin.tsx`
- Modify: `src/recognition-admin.css`
- Create: `scripts/seasonal-admin-ui.test.mjs`
- Modify: `scripts/recognition-admin-ui.test.mjs`.

**Interfaces:**
- Consumes: Task 2 campaign RPCs and Tasks 4–6 production scenes.
- Produces Administration controls for campaign list/editor, schedule/publish/cancel, materialization counts, full/balanced/reduced/static previews, New Year variant preview, Birthday personalized/no-photo preview, and delivery health.

- [ ] **Step 1: Write failing Administration UI tests**

Assert:

- plain-text-only fields, year/type/audience uniqueness, validated timezone/windows;
- optimistic concurrency on save/publish/cancel;
- explicit confirmation before publish/cancel;
- preview imports production scenes and writes no campaign/delivery state;
- asset-health/static-fallback preview exists;
- materialized campaigns lock audience/source identity;
- delivery health shows aggregate counts only;
- mobile/tablet preview viewport controls are keyboard accessible.

- [ ] **Step 2: Run RED**

```bash
node --test \
  scripts/seasonal-admin-ui.test.mjs \
  scripts/recognition-admin-ui.test.mjs
```

Expected: FAIL because scheduler/variants are absent.

- [ ] **Step 3: Implement the scheduler and previews**

Use Task 2 RPCs only. Preview payload is sample data and never invokes publish/materialize/claim/present APIs. Show dates in selected timezone while sending UTC timestamps.

- [ ] **Step 4: Run GREEN**

```bash
node --test \
  scripts/seasonal-admin-ui.test.mjs \
  scripts/recognition-admin-ui.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add \
  src/modules/RecognitionCelebrationsAdmin.tsx \
  src/recognition-admin.css \
  scripts/seasonal-admin-ui.test.mjs \
  scripts/recognition-admin-ui.test.mjs
git commit -m "feat(recognition): add seasonal campaign administration"
```

---

### Task 9: Certify T5 Performance, Accessibility, Security, and Deployment

**Files:**
- Modify only files required by RED→GREEN fixes discovered during verification.

**Interfaces:**
- Consumes: all T5 tasks.
- Produces: merge-ready seasonal branch and launch evidence.

- [ ] **Step 1: Run focused suites**

```bash
node --test \
  scripts/seasonal-campaigns.contract.test.mjs \
  scripts/seasonal-dispatch-security.test.mjs \
  scripts/seasonal-scene-architecture.test.mjs \
  scripts/christmas-celebration.test.mjs \
  scripts/new-year-celebration.test.mjs \
  scripts/seasonal-asset-budget.test.mjs \
  scripts/birthdays.test.mjs \
  scripts/celebration-protected-surfaces.test.mjs \
  scripts/recognition-ceremony-queue.test.mjs \
  scripts/seasonal-admin-ui.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run full application gates**

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all exit 0.

- [ ] **Step 3: Run local Supabase and Edge gates**

```bash
supabase db reset
npm run test:supabase
```

Serve/test `recognition-seasonal-dispatch` locally with correct, missing, and incorrect cron secret; verify only the correct secret succeeds and no secret is logged.

- [ ] **Step 4: Inspect build output and assets**

Verify normal startup chunks exclude seasonal scenes/assets; lazy chunks and every asset meet the specified budgets; no unexpected remote URLs or source maps containing secrets.

- [ ] **Step 5: Perform visual/accessibility QA**

Cover:

- Christmas full, balanced, reduced, static, asset-failure, desktop, mobile;
- New Year live and delayed with server-selected variant;
- Birthday with photo, initials fallback, wishes, replay;
- Escape, close, backdrop, focus return, screen reader label, contrast;
- low-memory/save-data downgrade;
- protected-surface deferral and two-per-session queue.

- [ ] **Step 6: Run production migration dry-run only**

```bash
supabase link --project-ref fkkxcivxnwshahnbatnp
supabase db push --dry-run
```

Expected: only `20261020330000_recognition_seasonal_campaigns.sql` and `20261020340000_recognition_birthday_delivery.sql`, assuming production is otherwise current. Do not deploy the Edge Function or migrations before PR merge approval.

- [ ] **Step 7: Request whole-branch review and use `superpowers:finishing-a-development-branch`**

After merge, deploy the migration, Edge Function, Vault/cron configuration, then verify campaign status and a non-production test campaign before enabling Christmas/New Year production campaigns.

# Department Trophy Cabinet, Personal Awards and Seasonal Celebrations — Repair and Product Design

**Date:** 2026-10-20
**Product:** RideArrivo RA-Workspace
**Status:** Approved for implementation
**Revision:** Adds premium Christmas, New Year and enhanced Birthday ceremonies to the approved Trophy & Awards architecture.
**Scope:** Restore the missing Department Trophy Cabinet in department workspaces, add a personal awards shelf to employee dashboards, guarantee one-time ceremony delivery to the correct audience, add governed seasonal company-wide celebrations, substantially improve Birthday presentation, and provide Administration preview/governance surfaces.

## 1. Purpose

RA-Workspace already has department achievement storage, a one-time claim-before-display ceremony flow, a premium celebration stage, and persistent achievement history. The current production experience is still incomplete because legitimate users cannot reliably see the Department Trophy Cabinet in the UI, personal achievements do not have a dedicated persistent shelf on Dashboard, and ceremony eligibility is not expressed through a durable per-recipient delivery model.

This repair must deliver five outcomes:

1. Every authorized department workspace visibly contains a Department Trophy Cabinet in the correct location, including an explicit empty state.
2. Every employee has a private personal awards shelf on Dashboard.
3. Each eligible recipient receives each major ceremony exactly once, including after being offline, while history remains permanently available.
4. Administration can preview the exact production ceremony without creating, consuming, or mutating real recognition records.
5. Christmas and New Year become the largest, most memorable company-wide ceremonies, while Birthday becomes substantially more personal and polished without weakening privacy, accessibility, or performance.

The work must preserve existing trophy history, recognition records, birthday wishes, one-time claim semantics, reduced-motion support, current department/workstation authorization, and application availability when celebration assets or delivery services fail.

## 2. Approved product decisions

The design locks in the following decisions:

- The Department Trophy Cabinet appears directly below the department header/team count and above the department workspace tabs.
- The cabinet remains visible when empty so employees can distinguish “no trophies yet” from “feature missing.”
- Legitimate department access includes current department membership, active workstation assignment, department-head authority, approved cross-department leadership access, and workspace-administrator authority.
- Every employee receives a private **My Awards** shelf on Dashboard.
- Personal awards are private to the employee by default.
- An individual award appears publicly only when it is explicitly classified as **Company recognition**.
- Department trophy ceremonies are shown to all active members of that department as captured at award time.
- Personal KPI or individual-award ceremonies are shown only to the employee who earned them unless the award is explicitly company-wide.
- Company-wide recognition may be shown to all active employees.
- New employees see existing department trophies in history but do not receive historical full-screen ceremonies unless an administrator explicitly reissues one.
- The existing premium celebration engine remains the shared visual renderer.
- No autoplay sound is introduced.
- Administration receives a no-write ceremony preview centre.
- Christmas and New Year are company-wide seasonal campaigns with the highest visual intensity, longest presentation window, and dedicated scene renderers.
- Seasonal campaigns are scheduled, versioned, auditable, and explicitly enabled by Administration; they are not inferred from the device date alone.
- Every active employee in the campaign audience receives one durable seasonal delivery; offline employees receive it on their next safe sign-in within the campaign validity window.
- Seasonal greetings are celebrations, not performance awards: they do not affect KPI calculations, award totals, rankings, or the employee `My Awards` shelf.
- Birthday uses a richer personalized scene and durable once-per-year delivery for the birthday employee; age is never displayed or inferred.
- Coworkers retain the existing birthday wish experience and do not receive the employee's full-screen birthday takeover.
- The full-screen shell remains shared, but Christmas, New Year and Birthday use focused scene components so the core stage does not become an oversized conditional renderer.
- No autoplay sound is introduced; any future sound must be explicitly opt-in at user level.

## 3. Existing foundation to preserve

The implementation must extend rather than replace the current system:

- `DepartmentAchievementCeremony` already delegates to the premium celebration stage.
- `PremiumCelebrationStage` already supports full-screen ribbon/confetti takeover, deterministic pieces, intro/hold timing, Escape/backdrop dismissal, and reduced-motion behavior.
- Existing department achievements already use claim-before-display and maintain persistent history independently from seen state.
- Existing major personal recognition already uses durable claim-before-display semantics.
- Existing birthday and ordinary lightweight recognition flows remain separate.
- The current Birthday presentation remains the canonical source for wishes and employee imagery, but its browser-local automatic-seen behavior is upgraded to durable, cross-device, once-per-year delivery.
- The existing `PremiumCelebrationStage` remains the accessible takeover shell; seasonal scenes extend it through composition rather than duplicating modal, focus, timer, dismissal, or reduced-motion logic.
- Existing department/workstation/administrator access remains authoritative.

Historical production migrations must not be edited. All schema work is additive.

## 4. Current defect and root cause

The Department Trophy Cabinet is mounted in the intended component tree, but the visibility decision is too narrow. It currently treats a matching profile department or workspace-administrator role as the primary authorization signal. That excludes legitimate users who can open a department workstation through another valid path, such as:

- an active workstation assignment;
- department-head authority;
- delegated cross-department leadership access;
- another governed access relationship.

The cabinet therefore disappears even though the user is legitimately inside the department workspace.

The repair must move the authorization decision to a server-controlled department-context RPC instead of relying on frontend comparisons between `profile.department` and a requested department name.

## 5. Product placement

### 5.1 Department workspace

The required order is:

```text
Department Workspace
  -> Department header / team count
  -> Department Trophy Cabinet
  -> Workspace / Collaboration / Discussion / Operations / Team tabs
```

The cabinet must render in this location for every authorized viewer.

### 5.2 Employee Dashboard

The personal shelf is placed in the signed-in employee Dashboard:

```text
Dashboard
  -> Needs your attention
  -> KPI / performance summary where available
  -> My Awards
  -> Tasks / calendar / updates
```

On constrained mobile layouts, the shelf becomes a horizontally scrollable award strip with a visible total and a `View all awards` action.

### 5.3 Administration

Administration gains:

```text
Administration
  -> Recognition & Celebrations
     -> Award governance
     -> Ceremony delivery health
     -> Seasonal campaign scheduler
     -> Ceremony Preview Centre
```

This surface must not grant recognition authority merely because a user can preview animations. Governance actions remain capability-controlled.

## 6. Department Trophy Cabinet design

### 6.1 Always-present shell

The component always renders after server authorization succeeds.

With trophies:

```text
+------------------------------------------------+
| Department Trophy Cabinet                  3   |
|                                                |
|              Featured Trophy                   |
|             Achievement title                  |
|              Earned date                       |
|                                                |
| ----------- illuminated glass shelf ---------- |
|  trophy        trophy        trophy             |
|                                                |
| View all department achievements               |
+------------------------------------------------+
```

Without trophies:

```text
Department Trophy Cabinet
This department has room for its first trophy.
Complete a qualifying achievement to begin the collection.
```

The empty state must not be hidden behind a history count or a feature flag.

### 6.2 Cabinet behavior

- The newest achievement is featured.
- Earlier achievements remain in permanent history.
- Ceremony seen/delivery state never removes an achievement from the cabinet.
- Realtime events are refresh signals only; the component refetches authorized history from the server.
- Stale responses are ignored when the user rapidly changes department workspaces.
- An authorization failure renders no protected trophy data and shows a neutral access message rather than an empty cabinet.

### 6.3 Department authorization

Create one server-authoritative resolver that returns the caller’s access relationship to the requested department.

Authorized relationships:

- `department_member`
- `workstation_assignee`
- `department_head`
- `delegated_leadership`
- `workspace_admin`

The browser supplies a department identifier only as a lookup target. The server validates the caller’s relationship before returning cabinet data.

No direct table reads from the browser are permitted for protected achievement or delivery tables.

## 7. Personal “My Awards” shelf

### 7.1 Purpose

The personal shelf gives every employee a stable place to see the awards they have earned after the ceremony closes. It must not depend on whether the ceremony was shown successfully.

### 7.2 Canonical award source

Use the existing employee recognition/award source as the canonical record. Do not create a second KPI calculation system.

The shelf consumes only finalized or issued award records that are valid for the signed-in employee.

### 7.3 Initial award categories

Supported presentation categories include:

- monthly KPI excellence;
- annual KPI excellence;
- Golden of the Week;
- major project contribution;
- clean overdue record;
- exceptional customer commendation;
- exceptional team commendation;
- service anniversary;
- mandatory training/compliance completion;
- verified identity/compliance milestone where a future policy explicitly awards it.

The system does not infer awards directly from arbitrary UI state. Automated awards require a verified source record or controlled materialization rule. Manual awards require an authorized issuer and audit evidence.

### 7.4 Visibility

Default:

```text
visibility = private
```

Optional explicit classification:

```text
visibility = company_recognition
```

Private awards are visible to:

- the employee;
- authorized People/Administration governance roles;
- explicitly authorized auditors where required.

Company-recognition awards may additionally appear in:

- the employee’s public internal profile;
- department recognition feed;
- company recognition feed;
- company-wide ceremony queue.

A manager or administrator cannot silently make private KPI detail public. Publishing requires a controlled action, an explicit reason, and an audit event.

## 8. Durable ceremony-delivery model

### 8.1 Problem solved

A single seen table tied only to a current department query is insufficient to guarantee delivery to every intended person. The system must snapshot recipients at award time and independently track each recipient’s presentation lifecycle.

### 8.2 Delivery table

Add `recognition_ceremony_deliveries`:

- `id uuid primary key`
- `source_kind text` — `department_achievement`, `personal_award`, `company_recognition`, `seasonal_campaign`, `birthday`
- `source_id uuid null` for table-backed achievements/campaigns
- `source_key text null` for deterministic recurring identities such as `birthday:<employee-id>:<year>`
- exactly one of `source_id` or `source_key` must be present
- `recipient_id uuid`
- `audience_type text` — `department`, `individual`, `company`
- `priority integer` for deterministic queue ordering; visual intensity and queue priority remain separate concepts
- `department_snapshot text null`
- `state text` — `pending`, `claimed`, `presented`, `dismissed`, `expired`, `revoked`
- `eligible_at timestamptz`
- `claimed_at timestamptz null`
- `presented_at timestamptz null`
- `dismissed_at timestamptz null`
- `expires_at timestamptz null`
- `created_at timestamptz`
- unique identity on `(source_kind, source_id, recipient_id)`

### 8.3 Recipient materialization

#### Department trophy

When a department achievement is created:

1. Resolve the canonical department.
2. Snapshot all active employees who are members of that department at that instant.
3. Insert one pending delivery per employee.
4. Emit a realtime notification signal.
5. Preserve the trophy in permanent department history regardless of delivery state.

#### Personal award

When an eligible major personal award is issued:

1. Insert one pending delivery for the award recipient.
2. If visibility is `company_recognition`, optionally create a separate company-audience announcement record rather than duplicating the private award payload to every employee.
3. Keep private performance evidence out of the company-wide presentation DTO.

#### Company recognition

For explicitly company-wide recognition:

1. Snapshot active employees at issue time.
2. Create one pending delivery per active employee.
3. Return only sanitized public recognition copy to non-recipient viewers.

#### Seasonal campaign

When an authorized seasonal campaign becomes eligible:

1. Lock the campaign row and confirm it is `published`, enabled, inside its configured delivery window, and not already materialized.
2. Snapshot every active employee in the selected company audience.
3. Insert one pending delivery per employee using `(source_kind, source_id, recipient_id)` uniqueness.
4. Mark the campaign materialized with the recipient count and materialization timestamp.
5. Emit a lightweight realtime refresh signal; the event payload is never treated as the protected ceremony DTO.
6. Employees who are offline retain their pending delivery until a safe sign-in opportunity before `expires_at`.

Campaign materialization is idempotent and is invoked through an authenticated, Vault-backed scheduled operation. It must not introduce an unauthenticated cron path or a service-role secret inside a cron command.

#### Birthday

On the employee's birthday in the configured company timezone:

1. Reuse the existing canonical birthday source and wish system.
2. Create a deterministic delivery identity `birthday:<employee-id>:<calendar-year>`.
3. Insert one pending individual delivery for the birthday employee only.
4. Do not include age, birth year, private HR data, or personal contact information in the ceremony DTO.
5. Preserve coworker wish cards and send-wish behavior after the automatic takeover closes.

Birthday delivery becomes durable across laptop, phone and iPad. A second device cannot claim the same annual automatic takeover. A user-triggered replay from the Birthday card may reuse presentation data without creating or re-claiming a delivery.

### 8.4 Claim-before-display

Use an atomic authenticated RPC:

```text
claim_next_recognition_ceremony()
```

Behavior:

- selects the oldest eligible pending delivery for `auth.uid()`;
- locks it with `FOR UPDATE SKIP LOCKED` or an equivalent safe pattern;
- changes it to `claimed` before returning;
- returns a redacted ceremony DTO;
- prevents parallel tabs from receiving the same delivery;
- never accepts an arbitrary recipient user ID from browser callers.

After the stage mounts successfully, the client records:

```text
mark_recognition_ceremony_presented(delivery_id)
```

Dismissal may record:

```text
mark_recognition_ceremony_dismissed(delivery_id)
```

Claim remains the duplicate-prevention boundary. A browser crash after claim does not replay the ceremony automatically; this preserves the existing anti-replay rule. Administration may explicitly reissue a delivery when justified.

### 8.5 Offline and transfer behavior

- Offline recipients retain pending deliveries until their next authenticated session.
- A later department transfer does not remove a delivery already earned.
- New department members see historical trophies but do not receive past full-screen ceremonies automatically.
- Inactive employees do not receive newly materialized deliveries.
- Deactivation revokes unclaimed future deliveries according to policy but does not delete award history.
- Seasonal deliveries expire after the campaign window; expiry removes the automatic takeover but does not erase the campaign audit/history record.
- No eligible delivery is silently discarded because another ceremony is active; it remains pending until the next safe presentation opportunity or expiry.

## 9. Ceremony audience rules

| Celebration type | Full-screen recipients | Persistent destination |
|---|---|---|
| Department trophy | Active members of the department at award time | Department cabinet |
| Private personal KPI/award | Award recipient only | Employee My Awards shelf |
| Company-recognition personal award | Award recipient plus sanitized company-wide announcement audience | Personal shelf and approved company feed |
| Company milestone | All active employees at award time | Company recognition history |
| Christmas campaign | All active employees snapshotted at campaign eligibility | Seasonal campaign history; excluded from award totals |
| New Year campaign | All active employees snapshotted at campaign eligibility | Seasonal campaign history; excluded from award totals |
| Birthday | Birthday employee only; coworkers retain wish cards | Existing birthday/wish history and day card |
| Administration preview | Previewing administrator only | No persistence |

The system must not expose private KPI scores, evidence, or internal notes in a company-wide ceremony. Seasonal and Birthday DTOs contain only approved greeting copy, display name where appropriate, and vetted visual-theme metadata.

## 10. Ceremony visual design

### 10.1 Rendering architecture

`PremiumCelebrationStage` remains responsible for:

- accessible modal/alert-dialog semantics;
- focus management and focus return;
- automatic hold/close timing;
- Escape, close-button, and backdrop dismissal;
- reduced-motion selection;
- queue lifecycle callbacks;
- safe fallback when a scene asset fails.

Focused scene components render the domain visuals:

```text
DepartmentTrophyScene
PersonalAwardScene
BirthdayCelebrationScene
ChristmasCelebrationScene
NewYearCelebrationScene
CompanyMilestoneScene
```

The shared stage must not accumulate large `if/else` blocks for every celebration. Each scene receives a sanitized presentation DTO and an explicit motion profile.

Supported visual intensity values become:

```text
standard
major
trophy
birthday
seasonal_max
```

Christmas and New Year use `seasonal_max`. The full profile renders approximately 180-220 deterministic festive elements plus foreground ribbon layers; the balanced profile renders 110-140. Birthday uses `birthday` with approximately 120-150 elements, richer than a normal major award but less visually dominant than the seasonal campaigns. Existing trophy/major presets retain their current 108-piece behavior.

### 10.2 Ceremony queue and safe presentation

Only one full-screen ceremony may be active at a time. The shell checks for safe presentation conditions:

- application shell is ready;
- user is not inside an active Room7 meeting/webinar, live support call, payment flow, or another protected full-screen task;
- no destructive confirmation or unsaved critical form is open;
- document visibility and focus state permit presentation.

If the moment is unsafe, the delivery remains pending. No ceremony is marked presented merely because it was claimed.

Recommended automatic queue order:

1. Birthday for the signed-in employee on the exact date;
2. New Year campaign within the live New Year window;
3. Christmas campaign;
4. company milestone/company-wide recognition;
5. department trophy;
6. major personal award.

The queue presents at most two automatic takeovers in one application session. Remaining deliveries stay pending and are offered at later safe opportunities. This prevents celebration fatigue without dropping any eligible ceremony. Visual intensity does not imply private-data priority.

### 10.3 Department trophy sequence

- `0.0s`: backdrop dims and navy/amber light sweep begins.
- `0.2s`: ribbons enter from top and both sides.
- `0.7s`: foreground streamers cross the viewport.
- `1.6s`: trophy halo/cabinet reveal begins.
- `2.0s`: trophy rises onto the pedestal.
- `2.4s`: department name appears.
- `3.0s`: achievement title and evidence copy appear.
- `7.0s`: automatic close, unless already dismissed.

### 10.4 Personal award sequence

Use the same shared stage with a personal-medal presentation, employee name, award category, and shareability-safe copy. Private award evidence remains outside the company-wide DTO.

### 10.5 Enhanced Birthday ceremony

Birthday becomes a warm, personal, premium scene rather than a generic confetti field.

Visual sequence:

- `0.0s`: soft navy backdrop with warm amber and rose glow;
- `0.2s`: layered balloons and ribbons rise from both lower corners;
- `0.8s`: gift boxes, stars and tasteful confetti enter at mixed depth;
- `1.5s`: the employee photo/avatar appears in a framed celebration medallion;
- `2.0s`: a cake/candle-light motif and name reveal appear;
- `2.5s`: the approved birthday greeting and coworker-wish prompt appear;
- `9.0s`: automatic close, unless dismissed earlier.

Birthday requirements:

- no age or birth year;
- no autoplay audio;
- avatar/photo remains optional and uses the existing protected profile-image path;
- a no-photo fallback uses initials and a premium illustration;
- coworker wish cards and wish composer remain available after close;
- a user may manually replay the visual from the Birthday card without creating a second delivery or notification.

### 10.6 Christmas ceremony — highest festive intensity

Christmas is a company-wide seasonal campaign and one of the two largest ceremonies. The experience must feel cinematic, thoughtful and premium rather than cartoonish or noisy.

Visual sequence:

- `0.0s`: deep winter-night scene with subtle parallax clouds, stars and restrained snow;
- `0.6s`: a high-quality pre-rendered Santa sleigh pulled by reindeer enters from the left, with realistic lighting and depth;
- `2.2s`: the sleigh crosses the upper viewport and leaves a warm gold trail;
- `3.0s`: the sleigh releases gift silhouettes and festive particles;
- `3.4s`: a major red/gold/green ribbon burst expands from centre and both sides;
- `4.2s`: wrapped gifts, snowflakes, ornaments, stars and soft light particles fall from the top at multiple depths;
- `5.0s`: the RideArrivo/company greeting panel appears with editable approved copy;
- `12.0s`: automatic close, unless dismissed earlier.

The Santa/reindeer sequence is a vetted built-in asset package, not an arbitrary user upload. Text remains HTML so it is accessible, localizable and never baked into imagery.

### 10.7 New Year ceremony — highest celebratory intensity

New Year shares the `seasonal_max` tier with Christmas and uses a midnight-blue, gold and silver visual language.

Two timing variants are required:

- **Live midnight variant:** available only inside the configured midnight window and may show a short `3 · 2 · 1` sequence before the burst.
- **Delayed greeting variant:** used for employees who first sign in later; it says `Welcome to <year>` and never replays a fake countdown.

Visual sequence:

- `0.0s`: midnight city/sky glow and subtle clock-ring motif;
- `0.8s`: live variant countdown or delayed greeting light build;
- `2.2s`: gold/silver ribbon and streamer takeover;
- `3.0s`: accessibility-safe fireworks/light blooms, never rapid flashing;
- `4.0s`: metallic confetti, stars and celebratory particles descend;
- `4.8s`: year and company greeting reveal;
- `11.0s`: automatic close, unless dismissed earlier.

### 10.8 Asset pipeline and performance budgets

Seasonal visual packages are lazy-loaded only when a pending matching delivery exists. They must not increase the normal RA-Workspace startup bundle.

Recommended implementation:

- CSS/canvas particles for ribbons, snow, fireworks and falling elements;
- optimized WebP/AVIF sprite atlases for the realistic Santa/reindeer pass;
- static WebP fallback when canvas/video/sprite decoding is unavailable;
- no third-party runtime asset host;
- no arbitrary remote images, SVG scripts, HTML, JavaScript, CSS, or fonts;
- hashed first-party asset paths and CSP-compatible loading.

Performance targets:

- seasonal package loaded on demand only;
- mobile compressed scene assets target `<= 1.5 MB`;
- desktop high-detail assets target `<= 3 MB`;
- static fallback `<= 250 KB`;
- sustained animation target `>= 50 fps` on supported modern devices, with automatic downgrade when frame health degrades;
- respect `navigator.connection.saveData` and low-memory/device capability signals by selecting the balanced/static profile.

### 10.9 Reduced motion and safety

When `prefers-reduced-motion: reduce` is active:

- suppress sleigh flight, countdown movement, fireworks, heavy ribbons and particle motion;
- display the complete themed greeting card immediately;
- preserve all text, iconography, employee/department identity and actions;
- retain keyboard and dismissal behavior.

No scene may use rapid flashes above accessibility-safe thresholds, rely on motion for essential meaning, or trap the user until the timer expires.

### 10.10 Accessibility

- `role="alertdialog"` or an equivalent accessible modal pattern;
- focus management and return focus;
- Escape dismissal;
- visible close action;
- no critical meaning conveyed by animation alone;
- no autoplay audio;
- sufficient color contrast in light and dark mode;
- live countdown text announced sparingly, not once per animation frame.

## 11. Administration Recognition & Celebrations centre

### 11.1 Preview Centre

Preview types:

- Department Trophy
- Monthly KPI Award
- Golden of the Week
- Enhanced Birthday
- Christmas — full, balanced and reduced-motion profiles
- New Year — live-midnight and delayed-greeting variants
- Company Milestone

Preview controls:

- desktop/tablet/mobile viewport;
- normal/reduced-motion mode;
- light/dark/system appearance;
- sample department/employee name;
- sample award title and detail;
- replay button;
- asset-health indicator and static-fallback preview;
- ability to preview the safe ceremony queue order without creating deliveries.

Preview mode must not:

- insert award records;
- insert delivery rows;
- mark any ceremony claimed/presented/dismissed;
- create notifications;
- write audit events other than an optional non-sensitive `PREVIEW_OPENED` operational event if desired later.


### 11.2 Seasonal campaign scheduler

Authorized Administration users may configure one Christmas and one New Year campaign per calendar year and company audience.

Create `recognition_seasonal_campaigns` with:

- `id uuid primary key`;
- `campaign_type text` — `christmas`, `new_year`;
- `calendar_year integer`;
- `title`, `message`, optional secondary detail;
- `theme_version text`;
- `audience_scope text` — the initial release uses `company`;
- `timezone text` containing a validated IANA timezone;
- `starts_at`, `ends_at`;
- `live_variant_starts_at`, `live_variant_ends_at` for New Year;
- `status text` — `draft`, `scheduled`, `published`, `materialized`, `cancelled`, `completed`;
- `enabled boolean`;
- `created_by`, `published_by`, timestamps;
- materialization count and timestamp;
- uniqueness preventing duplicate active campaigns for the same type/year/audience.

Administration may edit draft copy and dates, preview the exact scene, schedule/publish, cancel before delivery, and inspect materialization counts. Allowed status flow is `draft -> scheduled -> published -> materialized -> completed`, with `draft|scheduled|published -> cancelled`. Once recipients are materialized, audience and source identity are immutable; copy corrections use a versioned campaign revision and audit event. An emergency cancellation after materialization revokes unclaimed deliveries with an audit record while preserving already-presented history.

Default suggested windows, editable by Administration:

- Christmas: 24 December 00:00 through 26 December 23:59 in company timezone;
- New Year live variant: 31 December 23:55 through 1 January 00:15;
- New Year delayed variant: 1 January 00:15 through 2 January 23:59.

The database stores UTC timestamps and the configured IANA timezone.

### 11.3 Delivery health

Authorized administrators can inspect aggregate delivery health:

- pending;
- claimed;
- presented;
- dismissed;
- revoked;
- delivery errors.

They may reissue a ceremony only through an audited RPC requiring a reason. Reissue creates a new delivery revision or resets the governed delivery under an explicit policy; it never silently deletes evidence.

### 11.4 Award governance

Authorized People/Administration roles may:

- issue a discretionary award;
- revoke an invalid award without deleting audit evidence;
- classify an award as private or company recognition;
- inspect the issuer, source, and visibility history.

The browser never mutates recognition tables directly.

## 12. API and RPC boundaries

Recommended authenticated RPCs:

```text
get_authorized_department_trophy_context(p_department text)
list_department_trophy_history(p_department text)
list_my_awards(p_limit integer, p_cursor timestamptz)
claim_next_recognition_ceremony()
mark_recognition_ceremony_presented(p_delivery_id uuid)
mark_recognition_ceremony_dismissed(p_delivery_id uuid)
list_recognition_delivery_health(...)
reissue_recognition_ceremony(p_delivery_id uuid, p_reason text)
issue_employee_award(...)
change_employee_award_visibility(...)
list_recognition_seasonal_campaigns(...)
save_recognition_seasonal_campaign(...)
publish_recognition_seasonal_campaign(...)
cancel_recognition_seasonal_campaign(...)
materialize_due_recognition_seasonal_campaigns()
preview_recognition_ceremony(p_theme text, p_payload jsonb)
```

All privileged functions must:

- use `SECURITY DEFINER` only where required;
- set a controlled `search_path`;
- verify active caller identity;
- evaluate capability server-side;
- revoke execution from `anon` and PostgreSQL `PUBLIC` before granting intended roles;
- return redacted DTOs;
- write immutable audit events for governance changes;
- ensure scheduled seasonal materialization uses the existing hardened cron-dispatch pattern and never embeds service-role credentials in job text.

## 13. Realtime behavior

Realtime is advisory, not authoritative.

- A new achievement/delivery event triggers a refetch or claim attempt.
- The client never trusts an event payload as the protected award record.
- Reconnect performs a fresh pending-delivery claim check.
- Sign-out clears in-memory ceremony queues.
- Rapid department switching invalidates earlier cabinet requests.
- Seasonal campaign publication and materialization events trigger a claim check but never include greeting recipient lists or protected employee identifiers.

## 14. Error handling

Celebration failures are non-blocking.

- If cabinet history fails, the workspace remains usable and the cabinet shows a retry state.
- If a delivery claim fails, the application shell continues loading.
- If the animation fails after a successful claim, the award remains in history and is not duplicated.
- If realtime is unavailable, the next application load or polling checkpoint finds pending deliveries.
- If a preview renderer fails, no recognition state is changed.
- If a seasonal asset fails to decode, the stage renders the static themed fallback and records presentation only after the fallback card mounts.
- If the scheduled materializer misses a run, the next authenticated run retries idempotently; campaign delivery is not duplicated.

## 15. Security and privacy requirements

- Personal awards are private by default.
- Company-recognition publication is explicit and audited.
- Private KPI values and evidence never enter company-wide DTOs.
- Department cabinet reads require a verified department-access relationship.
- Employees cannot claim or acknowledge another user’s delivery.
- Ordinary browser users cannot insert, update, or delete delivery records directly.
- Unrelated employees cannot read another employee’s private award shelf.
- Workspace administrators have governance access but do not become award recipients automatically.
- Service-role access is restricted to controlled server operations and never used by browser code.
- Seasonal campaign copy accepts plain text only; arbitrary HTML, scripts, remote styles, uploaded fonts, and third-party tracking pixels are rejected.
- Seasonal campaigns never expose employee birthday, age, KPI, or HR evidence to company-wide recipients.

## 16. Testing strategy

### 16.1 Static/contract tests

Verify:

- cabinet is mounted between header and tabs;
- empty cabinet state is rendered;
- Dashboard mounts `MyAwardsShelf`;
- premium stage timings and reduced-motion behavior remain exact;
- Preview Centre imports the production stage and contains no persistence calls;
- Christmas, New Year and Birthday scenes are focused components composed inside the shared stage;
- seasonal assets are lazy-loaded and absent from the normal application entry bundle;
- all scenes include static and reduced-motion fallbacks and contain no autoplay-audio path;
- seasonal full/balanced and Birthday scene element counts remain inside the approved performance ranges;
- browser code uses RPCs rather than direct protected-table writes.

### 16.2 Supabase E2E tests

Verify:

- current department member can read cabinet;
- workstation assignee can read the related cabinet;
- department head can read the cabinet;
- delegated leadership and workspace admin follow approved access rules;
- unrelated employee cannot read cabinet history;
- every active department member at award time gets one delivery;
- inactive employees get none;
- a later department transfer does not remove an earned delivery;
- a new member does not get a historical takeover;
- parallel claims return the delivery once;
- offline pending delivery is claimable on next session;
- personal shelf is caller-scoped;
- company recognition returns sanitized copy to non-recipient viewers;
- private KPI detail remains private;
- history remains after claimed/presented/dismissed state;
- preview creates no writes;
- reissue requires authority and reason and is audited;
- Christmas/New Year campaign materialization snapshots every active employee exactly once;
- offline seasonal recipients claim one pending ceremony inside the validity window;
- expired seasonal deliveries do not auto-present and are not counted as awards;
- duplicate scheduled materializer calls do not duplicate recipients;
- New Year live-midnight and delayed variants are selected from server time/window, not the browser clock alone;
- birthday automatic takeover is durable once per employee/year across devices, contains no age, and preserves coworker wishes;
- scene asset failure renders the static fallback without losing the delivery;
- ceremony queue serializes takeovers and retains deferred deliveries;
- reduced-motion and save-data/device downgrade behavior preserve all message content.

### 16.3 Full gates

- `npm run typecheck`
- focused Node tests
- full `npm test`
- `npm run build`
- `git diff --check`
- `supabase db reset`
- `npm run test:supabase`
- production `supabase db push --dry-run`
- mobile responsive visual QA
- reduced-motion visual QA
- Christmas/New Year full, balanced, static-fallback and low-end mobile QA
- Birthday personalized/no-photo/wishes-preserved QA
- ceremony queue conflict QA with active Room7/support-call surfaces

## 17. Rollout plan

### Phase T1 — Visibility repair

- server-authoritative department-context resolver;
- cabinet always rendered with explicit empty/error states;
- correct placement and responsive shelf UI;
- regression tests for all access paths.

### Phase T2 — Personal awards shelf

- Dashboard `My Awards` shelf;
- private-by-default visibility;
- full awards history;
- controlled company-recognition classification.

### Phase T3 — Durable ceremony delivery

- recipient snapshot/materialization;
- delivery ledger;
- atomic claim/present/dismiss RPCs;
- offline and parallel-tab guarantees;
- migration/backfill policy for current eligible records.

### Phase T4 — Administration preview and governance

- Preview Centre;
- delivery health;
- controlled reissue;
- award issuance/revocation/visibility governance.

### Phase T5 — Seasonal and enhanced personal ceremonies

- `recognition_seasonal_campaigns`;
- Administration scheduler and yearly campaign governance;
- durable Christmas and New Year recipient materialization;
- `ChristmasCelebrationScene` and `NewYearCelebrationScene`;
- enhanced `BirthdayCelebrationScene` and durable yearly delivery;
- safe ceremony queue and protected-surface deferral;
- lazy asset packages, performance downgrade and static fallbacks;
- Administration preview variants and visual QA.

Each phase should have its own focused tests and may be delivered as one coordinated PR only if the final migration/test gate remains reviewable. The recommended implementation plan may group T1–T4 into one branch with separate commits because the interfaces are tightly coupled.

## 18. Acceptance criteria

The repair is accepted only when:

- every authorized department workspace visibly shows the cabinet beneath the header and above tabs;
- an empty department displays an explicit empty shelf;
- legitimate workstation-assignment access no longer hides the cabinet;
- unrelated employees remain denied;
- every employee sees a private `My Awards` shelf on Dashboard;
- personal awards remain private unless explicitly published as company recognition;
- all intended department recipients receive exactly one ceremony, including after being offline;
- refresh and parallel tabs do not replay ceremonies;
- permanent department and personal history remains visible after ceremony consumption;
- Administration can preview every ceremony without database writes;
- the production ceremony remains premium, accessible, dismissible, and reduced-motion aware;
- every active employee in a published Christmas/New Year campaign receives one ceremony within the valid window, including after being offline;
- Christmas includes the vetted Santa/reindeer sleigh pass, gift/ribbon burst and festive falling elements with a reliable static fallback;
- New Year selects the live countdown only inside the configured midnight window and uses a delayed greeting later;
- Birthday is richer, personalized, durable once per year across devices, omits age, and preserves coworker wishes;
- seasonal greetings never alter award totals, KPI values or `My Awards`;
- seasonal assets remain lazy-loaded and do not regress normal workspace startup;
- all full application, Supabase, security, and build gates pass.

## 19. Non-goals

This repair does not:

- invent or calculate new KPI metrics;
- replace the current employee-recognition source;
- turn identity/KYC completion into a performance score;
- add autoplay sound;
- disclose private award evidence company-wide;
- redesign unrelated Dashboard modules;
- resume Room7 Webinar W1 until the trophy/awards/seasonal repair is verified and merged;
- add arbitrary user-uploaded animation code, fonts, HTML or third-party tracking;
- add autoplay music or sound effects;
- treat Christmas/New Year greetings as merit awards or employee-performance evidence;
- guarantee cinematic full-motion rendering on devices that require reduced, balanced or static fallback modes.


## 20. Revision history

### Revision 2 — Seasonal ceremony amendment

Approved amendment adds:

- Christmas and New Year as the highest-intensity company-wide ceremony tier;
- realistic Santa/reindeer sleigh scene, gift/ribbon burst and festive falling elements;
- live-midnight and delayed New Year variants;
- richer personalized Birthday presentation with durable once-per-year delivery;
- seasonal campaign scheduler, recipient materialization, delivery expiry and audit model;
- ceremony queue/safe-surface deferral;
- lazy asset budgets, low-end-device downgrade, static fallback and accessibility safety;
- Preview Centre coverage for all new variants.

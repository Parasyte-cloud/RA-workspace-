# RA Workspace Responsive Liquid Glass Core Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate RA Workspace core work surfaces to the shared responsive/liquid-glass system while preserving existing workflows and permissions.

**Architecture:** Use the shell/tokens from the foundation plan, then adapt known high-traffic modules in small groups. Prefer CSS/shared classes for layout changes; modify component markup only where semantic grouping, accessible actions, adaptive tables/cards, or mobile sheets require it.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md`

## Global Constraints

- Foundation plan must be complete and green first.
- Do not change Supabase RPCs, queries, permissions, or business action meaning unless required only to expose existing labels/semantics to the UI.
- Preserve lazy loading/module boundaries.
- Forms must use at least 16px input text on compact iOS layouts to avoid unwanted zoom.
- Tables use cards only when row semantics survive; comparison-heavy finance/admin tables retain controlled horizontal scrolling/sticky key columns.

## Review Focus

- 320px long form: validation and submit action stay visible and usable.
- Wide finance/admin table on 390px: controlled horizontal scroll does not become page-level overflow.
- Long filenames/employee names wrap or truncate without hiding actions.
- Tablet portrait cards do not become oversized single-column phone cards.
- Empty/loading/error states keep the same action availability as desktop.

---

### Task 1: Add core responsive module contracts

**Files:**
- Create: `scripts/responsive-core-modules.test.mjs`
- Modify: `scripts/run-tests.mjs` only if needed by the project's explicit registry.

**Interfaces:**
- Consumes: current module/source CSS.
- Produces: contract that core modules use shared responsive primitives and avoid known overflow/fixed-width hazards.

- [ ] **Step 1: Write failing tests**

Cover these source groups when present in the current branch; if a listed file has been renamed, stop and reconcile against current `git ls-files`, do not silently substitute:
- `src/modules/PersonalDashboard.tsx` + `src/personal-dashboard.css`
- `src/modules/DepartmentTeamWorkspace.tsx`
- `src/modules/MarketingTeamWorkspace.tsx`
- `src/modules/FinanceBanking.tsx`
- `src/modules/DepartmentAdminView.tsx`
- `src/modules/AdminAccessManager.tsx`
- `src/modules/ApplicationsHub.tsx`
- `src/modules/CoreModules.tsx`
- `src/modules/BusinessModules.tsx`
- `src/modules/Phase2Modules.tsx`
- `src/modules/ProfileModule.tsx`
- `src/modules/MailModule.tsx`
- `src/modules/SocialModule.tsx`
- `src/modules/SupportOperationsPanel.tsx`
- `src/modules/SharedWorkspacesHub.tsx`
- `src/modules/DataWorkbench.tsx`
- `src/components/EmployeeVirtualCard.tsx`
- `src/components/BrandLibrary.tsx`

Assertions:
- no module introduces a new `100vh` full-screen rule where `100dvh` shell primitives should own height;
- no compact-targeted primary container requires a fixed `min-width` greater than 599px;
- form input/textarea/select compact rules are >=16px;
- shared empty/error/loading class markers exist for migrated surfaces;
- wide data tables have a named scroll wrapper rather than relying on body overflow;
- migrated modules do not define their own heavy `backdrop-filter`; glass blur stays centralized in `src/liquid-glass.css`.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/responsive-core-modules.test.mjs
```
Expected: FAIL on current inconsistent module patterns.

### Task 2: Migrate dashboard and workstation surfaces

**Files:**
- Modify: `src/modules/PersonalDashboard.tsx`
- Modify: `src/personal-dashboard.css`
- Modify: `src/modules/DepartmentTeamWorkspace.tsx`
- Modify: `src/modules/MarketingTeamWorkspace.tsx`
- Modify: `src/modules/SharedWorkspacesHub.tsx`
- Modify: `src/workflow.css` when shared workstation layout rules belong there.
- Test: `scripts/responsive-core-modules.test.mjs`

**Interfaces:**
- Consumes: shared `.glassSurface`, `.workSurface`, shell gutters/layout modes.
- Produces: summary-first dashboard cards, adaptive tool/workstation grids, compact single-task flow, medium two-column behavior, readable wide layouts.

- [ ] **Step 1: Implement only layout/presentation changes**

Keep all existing handlers, queries, role checks, and action callbacks intact. Move visually secondary actions into existing menus/details where available rather than inventing new business actions.

- [ ] **Step 2: Run focused tests/typecheck**

```bash
node --test scripts/responsive-core-modules.test.mjs
npm run typecheck
```
Expected: dashboard/workstation assertions pass.

- [ ] **Step 3: Manual viewport smoke**

Check Personal Dashboard and at least one employee workstation plus Marketing/Shared workspace at 360, 390, 768, 820, 1280 widths.

- [ ] **Step 4: Commit**

Stage only the files above plus the test file; `git diff --cached --check`; commit `feat: modernize responsive workspace dashboards`.

### Task 3: Migrate forms, admin, finance, data, files, and common work surfaces

**Files:**
- Modify: `src/modules/FinanceBanking.tsx`
- Modify: `src/modules/DepartmentAdminView.tsx`
- Modify: `src/modules/AdminAccessManager.tsx`
- Modify: `src/modules/ApplicationsHub.tsx`
- Modify: `src/modules/CoreModules.tsx`
- Modify: `src/modules/BusinessModules.tsx`
- Modify: `src/modules/Phase2Modules.tsx`
- Modify: `src/modules/ProfileModule.tsx`
- Modify: `src/modules/MailModule.tsx`
- Modify: `src/modules/SocialModule.tsx`
- Modify: `src/modules/SupportOperationsPanel.tsx`
- Modify: `src/modules/DataWorkbench.tsx`
- Modify: `src/components/EmployeeVirtualCard.tsx`
- Modify: `src/components/BrandLibrary.tsx`
- Modify: `src/responsive.css` only for shared rules that genuinely apply across multiple modules.
- Test: `scripts/responsive-core-modules.test.mjs`

**Interfaces:**
- Consumes: foundation layout/surface classes.
- Produces: adaptive forms, data wrappers, file metadata/action layouts, readable compact cards, touch-safe admin controls.

- [ ] **Step 1: Extend RED tests for data/form semantics**

Add assertions that migrated form containers have compact one-column markers, data tables use a local scroll wrapper or compact record-card class, and destructive actions remain explicitly labelled.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/responsive-core-modules.test.mjs
```
Expected: new assertions fail.

- [ ] **Step 3: Implement adaptive layout only**

Do not rewrite data fetching or submit handlers. For tables, choose per surface between `.responsiveTableScroller` and `.responsiveRecordList`; comparison-heavy finance/admin tables default to the scroller strategy. Existing dialogs/drawers in these files must adopt the shared compact sheet/full-screen presentation rules and preserve focus restoration; do not create a second overlay system.

- [ ] **Step 4: GREEN and full gate**

```bash
node --test scripts/responsive-core-modules.test.mjs
npm run typecheck
npm test
npm run build
git diff --check
```
Expected: PASS.

- [ ] **Step 5: Manual viewport matrix for representative core modules**

At minimum verify one long form, one finance/admin comparison table, one file/document list, one profile/settings form, and one mail/social surface at 320, 390, 768, 820, 1024, 1440.

- [ ] **Step 6: Commit**

Stage only the exact files modified in this task plus `scripts/responsive-core-modules.test.mjs`; inspect `git diff --cached --name-only`; commit `feat: adapt core work surfaces for every screen`.

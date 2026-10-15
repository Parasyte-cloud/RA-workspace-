# RA Workspace Responsive Liquid Glass Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved RA Workspace responsive liquid-glass redesign across desktop, laptop, phone, tablet, and iPad, add visible sender names to incoming room messages, then push, open a PR, pass CI, squash merge, and synchronize local `main`.

**Architecture:** Execute four independently verifiable slices on one isolated branch/worktree: shared shell/design system, core modules, communication/Room7 surfaces, and Chat sender identity plus final QA. Preserve existing backend/business behavior and authorization; the work is presentation/responsiveness except for the approved room sender-name rendering change.

**Tech Stack:** React, TypeScript, Vite, CSS, Supabase client, Node test runner, Git, GitHub CLI, Cloudflare Pages CI/deploy pipeline already attached to the repository.

**Spec:** `docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md`

## Global Constraints

- Branch: `feat/responsive-liquid-glass-ui` in an isolated worktree created at execution time with `superpowers:using-git-worktrees`.
- Preserve current Supabase schema, RLS, authorization, roles, department permissions, Chat membership semantics, Room7 media/session logic, and existing route/module splitting.
- Do not modify Partnership room authorization in this project.
- Do not change Chat receipts, mentions, calls, attachments, message authorization, or Enter/Return semantics.
- Compact layout target: up to 599px CSS width; medium: 600-1023px; wide: 1024px and above.
- Prefer `100dvh` plus fallbacks and `env(safe-area-inset-*)` for full-height compact surfaces.
- No essential interaction may depend on hover.
- Do not add a large UI framework or new runtime dependency solely for this redesign.
- Never use `git add .`; stage explicit intended paths only.
- Never clean, delete, reset, or stage unrelated untracked artifacts.
- Each behavioral change follows RED -> GREEN -> regression verification before commit.
- Final merge requires typecheck, full tests, production build, `git diff --check`, CI pass, mergeable PR, squash merge, and `origin/main...HEAD` = `0 0` after sync.

## Review Focus

- 320px phone with keyboard open: primary content stays scrollable and the active composer/submit action remains reachable.
- iPad portrait/landscape transitions: navigation and split panes do not leave hidden, duplicated, or unreachable controls.
- Long unbroken names/filenames/URLs: no page-level overflow or clipped primary actions.
- Reduced-motion and no-backdrop-filter environments: the UI remains readable and state changes remain understandable.
- Touch-only interaction: every action exposed on desktop hover has a visible button, menu, or sheet equivalent.

---

## Plan Set and Required Order

### Plan 1 - Foundation and shell

File: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-foundation.md`

Produces the shared tokens, glass surfaces, layout modes, application shell, navigation behavior, safe-area rules, and shell-level tests that every later slice consumes.

### Plan 2 - Core modules

File: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-core-modules.md`

Consumes Plan 1 and migrates dashboards, department/workstation surfaces, data tables, forms, files/documents, admin/legal/finance/common work surfaces.

### Plan 3 - Communication and Room7

File: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-communications-room7.md`

Consumes Plan 1 and migrates communication/Room7 surfaces without changing media/session or authorization behavior.

### Plan 4 - Chat sender identity, final QA, release

File: `docs/superpowers/plans/2026-10-15-chat-room-sender-final-release.md`

Consumes Plans 1-3, adds visible room sender names with minimal grouping, runs the cross-app/Chat QA matrix, performs final verification, pushes the branch, opens the PR, watches CI, squash merges, and synchronizes `main`.

---

### Task 1: Materialize approved spec and plan set in the isolated worktree

**Files:**
- Create: `docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md`
- Create: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-master-plan.md`
- Create: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-foundation.md`
- Create: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-core-modules.md`
- Create: `docs/superpowers/plans/2026-10-15-responsive-liquid-glass-communications-room7.md`
- Create: `docs/superpowers/plans/2026-10-15-chat-room-sender-final-release.md`

**Interfaces:**
- Consumes: approved design artifact supplied by the user.
- Produces: repository-local source of truth for all implementation slices.

- [ ] **Step 1: Create isolated worktree**

Use `superpowers:using-git-worktrees`, based on fresh `origin/main`, branch `feat/responsive-liquid-glass-ui`.

- [ ] **Step 2: Confirm repository safety before copying artifacts**

Run:
```bash
git status --short
git branch --show-current
git rev-list --left-right --count origin/main...HEAD
```
Expected: intended feature branch, no tracked modifications, no unexpected divergence.

- [ ] **Step 3: Copy the approved spec and all five plan documents into the exact repository paths above**

Do not modify product code in this task.

- [ ] **Step 4: Verify documentation diff**

Run:
```bash
git diff --check
git status --short
```
Expected: only the six documentation files above are new/modified.

- [ ] **Step 5: Commit documentation**

```bash
git add -- \
  docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md \
  docs/superpowers/plans/2026-10-15-responsive-liquid-glass-master-plan.md \
  docs/superpowers/plans/2026-10-15-responsive-liquid-glass-foundation.md \
  docs/superpowers/plans/2026-10-15-responsive-liquid-glass-core-modules.md \
  docs/superpowers/plans/2026-10-15-responsive-liquid-glass-communications-room7.md \
  docs/superpowers/plans/2026-10-15-chat-room-sender-final-release.md

git diff --cached --check
git commit -m "docs: plan responsive liquid glass redesign"
```

### Task 2: Execute Plans 1-4 in order

**Files:** Defined by each sub-plan.

**Interfaces:**
- Consumes: committed spec/plan set.
- Produces: completed feature branch ready for release.

- [ ] **Step 1: Execute Plan 1 completely**

Do not start Plan 2 until Plan 1 focused tests, typecheck, full tests, build, diff check, and its visual smoke checks pass.

- [ ] **Step 2: Execute Plan 2 completely**

Do not start Plan 3 until Plan 2 verification passes.

- [ ] **Step 3: Execute Plan 3 completely**

Do not start Plan 4 until Plan 3 verification passes.

- [ ] **Step 4: Execute Plan 4 completely**

Plan 4 owns sender-name behavior, final full verification, PR/CI/merge, and `main` synchronization.

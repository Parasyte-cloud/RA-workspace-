# RA Workspace Responsive Liquid Glass Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one responsive visual system and one coherent application shell for compact, medium, and wide RA Workspace layouts without changing business behavior.

**Architecture:** Consolidate shared tokens in the existing global styling layer, add a focused liquid-glass surface layer, then evolve the existing App/PhoneNav/workspace navigation CSS rather than introducing a second navigation system. Use CSS-first responsive rules, dynamic viewport units, safe-area insets, and touch/keyboard parity.

**Tech Stack:** React, TypeScript, Vite, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md`

## Global Constraints

- Preserve route/module visibility and role-based navigation decisions already computed by the app.
- Compact <=599px, medium 600-1023px, wide >=1024px.
- `100dvh` is preferred for full-height app surfaces with a non-dynamic fallback.
- Use existing RideArrivo variables/colors where possible; do not duplicate brand truth.
- Glass effects must have readable opaque/translucent fallbacks.
- No essential hover-only controls.
- No new runtime UI framework.

## Review Focus

- Safe-area bottom navigation on iPhone-like devices does not cover page content.
- 768-820px tablet widths use a rail/drawer model, not a stretched phone bottom bar.
- Long navigation labels do not force horizontal scrolling.
- `prefers-reduced-motion` disables non-essential motion.
- `backdrop-filter` unsupported: navigation/sheets remain readable.

---

### Task 1: Add failing shell/responsive contracts

**Files:**
- Create: `scripts/responsive-shell.test.mjs`
- Modify: `scripts/run-tests.mjs` only if the project runner uses an explicit test registry.
- Inspect/retain: `scripts/phone-shell.test.mjs`, `scripts/workspace-nav.test.mjs`.

**Interfaces:**
- Consumes: current `src/App.tsx`, `src/modules/PhoneNav.tsx`, `src/styles.css`, `src/workspace-shell.css`, `src/responsive.css`, `src/phone-shell.css`, `src/workspace-nav.css`.
- Produces: regression contract for shared layout modes, safe-area/dvh behavior, reduced motion, glass fallback, and touch navigation.

- [ ] **Step 1: Write the failing test**

Create source-level assertions named:
- `shared shell defines compact medium and wide layout modes`
- `full height shell uses dynamic viewport and safe area fallbacks`
- `phone navigation exposes a More affordance without horizontal scrolling`
- `glass surfaces have a non backdrop-filter fallback`
- `reduced motion disables non essential transitions`

Assert exact markers in the CSS/PhoneNav files; do not assert implementation whitespace.

- [ ] **Step 2: Run RED**

Run:
```bash
node --test scripts/responsive-shell.test.mjs scripts/phone-shell.test.mjs scripts/workspace-nav.test.mjs
```
Expected: new responsive-shell assertions fail for missing unified behavior while existing tests remain green.

- [ ] **Step 3: Commit tests only is not allowed yet**

Keep RED test uncommitted until the corresponding implementation is green.

### Task 2: Consolidate tokens and liquid-glass surfaces

**Files:**
- Modify: `src/styles.css`
- Create: `src/liquid-glass.css`
- Modify: `src/InternalApp.tsx`
- Test: `scripts/responsive-shell.test.mjs`

**Interfaces:**
- Consumes: existing brand/theme variables imported by `InternalApp`.
- Produces: shared CSS custom properties and reusable classes `.glassSurface`, `.glassNav`, `.glassSheet`, `.workSurface`, `.uiFocusRing` for later tasks.

- [ ] **Step 1: Implement the minimal shared tokens**

Add variables for compact/medium/wide gutters, spacing scale, radii, control heights, touch target minimum, navigation dimensions, glass opacity, blur, border, shadow, motion timing, safe-area aliases, and z-index bands. Reuse current accent/panel/text variables rather than redefining brand colors.

- [ ] **Step 2: Implement liquid-glass primitives**

`src/liquid-glass.css` must provide the classes above, including `@supports (backdrop-filter: blur(...))` enhancement and readable base backgrounds outside that support block.

- [ ] **Step 3: Import the new stylesheet once**

Add `import './liquid-glass.css'` in `src/InternalApp.tsx` adjacent to the other shell/theme stylesheet imports.

- [ ] **Step 4: Run GREEN for shared surface contracts**

```bash
node --test scripts/responsive-shell.test.mjs
npm run typecheck
```
Expected: token/glass assertions pass and TypeScript remains clean.

- [ ] **Step 5: Commit**

```bash
git add -- src/styles.css src/liquid-glass.css src/InternalApp.tsx scripts/responsive-shell.test.mjs
git diff --cached --check
git commit -m "style: establish responsive glass design system"
```

### Task 3: Rework the global shell and navigation by layout mode

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/modules/PhoneNav.tsx`
- Modify: `src/workspace-shell.css`
- Modify: `src/responsive.css`
- Modify: `src/phone-shell.css`
- Modify: `src/workspace-nav.css`
- Test: `scripts/responsive-shell.test.mjs`
- Test: `scripts/phone-shell.test.mjs`
- Test: `scripts/workspace-nav.test.mjs`

**Interfaces:**
- Consumes: token/glass classes from Task 2 and current role-filtered navigation model.
- Produces: wide collapsible side navigation, medium rail/drawer behavior, compact bottom navigation with More sheet, compact header/action behavior, and one scroll owner for the main workspace surface.

- [ ] **Step 1: Extend RED tests for interaction structure**

Add assertions that PhoneNav renders 4-5 primary destinations plus a `More` trigger, the More surface has an accessible label and close mechanism, and tablet CSS hides compact bottom navigation in favor of rail/drawer behavior.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/responsive-shell.test.mjs scripts/phone-shell.test.mjs scripts/workspace-nav.test.mjs
```
Expected: new structure assertions fail.

- [ ] **Step 3: Implement compact/medium/wide shell behavior**

Preserve the current navigation data/role filtering. Change only presentation/state needed for collapse/More sheet. Use `min-height: 0`, `overflow` ownership, `100dvh` fallback, and safe-area padding in CSS rather than JS resize listeners.

- [ ] **Step 4: Add touch and keyboard parity**

Every icon-only nav control gets an accessible name; focus-visible styling uses `.uiFocusRing` or equivalent tokenized rule; hover enhancements are paired with focus/active/touch states.

- [ ] **Step 5: Run focused GREEN**

```bash
node --test scripts/responsive-shell.test.mjs scripts/phone-shell.test.mjs scripts/workspace-nav.test.mjs
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Manual shell viewport smoke**

Verify authenticated shell at 320, 390, 430, 768 portrait, 820 portrait, 1024 landscape, 1280, and 1440 widths. Check navigation, More sheet/drawer, page header, scroll ownership, safe areas, and no page-level horizontal overflow.

- [ ] **Step 7: Regression/build gate**

```bash
npm test
npm run build
git diff --check
```
Expected: PASS; existing build-size warnings may remain if pre-existing, but no new errors.

- [ ] **Step 8: Commit**

```bash
git add -- \
  src/App.tsx \
  src/modules/PhoneNav.tsx \
  src/workspace-shell.css \
  src/responsive.css \
  src/phone-shell.css \
  src/workspace-nav.css \
  scripts/responsive-shell.test.mjs \
  scripts/phone-shell.test.mjs \
  scripts/workspace-nav.test.mjs

git diff --cached --check
git commit -m "feat: unify responsive workspace shell"
```

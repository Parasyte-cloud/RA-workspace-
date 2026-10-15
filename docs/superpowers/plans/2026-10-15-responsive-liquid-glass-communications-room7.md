# RA Workspace Responsive Liquid Glass Communications and Room7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the shared responsive/liquid-glass system to Room7 and adjacent communication/call surfaces without changing meeting, call, media, guest, or authorization semantics.

**Architecture:** Keep existing Room7 component/session boundaries and CSS files. Add responsive/touch behavior around current controls and panels, using shared surfaces/tokens from the foundation plan and preserving all existing backend calls.

**Tech Stack:** React, TypeScript, CSS, Supabase/RealtimeKit integrations already present, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md`

## Global Constraints

- No changes to Room7 session/media permission logic, guest admission, room-event-control, room-session, or Supabase authorization unless a test proves a presentation-only bug cannot be solved client-side.
- Preserve existing call controls and call history semantics.
- Touch controls must remain reachable in portrait and landscape.
- Public Room7 remains lazy-loaded/separate from the internal workspace surface.

## Review Focus

- iPad landscape with participant/details panel open does not hide meeting controls.
- Phone portrait meeting controls remain tappable without overlapping safe areas.
- Incoming call/ringer overlays do not block navigation or become clipped by viewport changes.
- Public Room7 guest flow remains usable at 320px without horizontal page scroll.
- Reduced-motion mode does not remove essential state feedback for ringing/meeting transitions.

---

### Task 1: Add communication/Room7 responsive regression contracts

**Files:**
- Create: `scripts/room7-responsive.test.mjs`
- Inspect/retain: `scripts/chat-calls.test.mjs`, existing Room7 tests, and `scripts/phone-shell.test.mjs`.

**Interfaces:**
- Consumes: current `src/modules/RoomModule.tsx`, `src/modules/RoomMeeting.tsx`, `src/modules/CallRinger.tsx`, `src/room.css`, `src/call-ringer.css`, `src/room7-public/ExternalRoom7App.tsx`, `src/room7-public/room7-public.css`.
- Produces: regression assertions for safe-area/touch layout and preservation of current Room7/call entry points.

- [ ] **Step 1: Write failing tests**

Assert:
- compact meeting controls use safe-area aware bottom padding;
- tablet rules support content + contextual panel without phone bottom-nav duplication;
- no Room7 full-height compact surface depends solely on `100vh`;
- primary call/end controls remain explicit buttons with accessible names;
- public Room7 keeps its existing separate surface/lazy boundary.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/room7-responsive.test.mjs scripts/chat-calls.test.mjs
```
Expected: new responsive assertions fail; existing call behavior tests stay green.

### Task 2: Migrate internal Room7 and call surfaces

**Files:**
- Modify: `src/modules/RoomModule.tsx`
- Modify: `src/modules/RoomMeeting.tsx`
- Modify: `src/modules/CallRinger.tsx`
- Modify: `src/room.css`
- Modify: `src/call-ringer.css`
- Test: `scripts/room7-responsive.test.mjs`
- Test: `scripts/chat-calls.test.mjs`

**Interfaces:**
- Consumes: foundation glass/tokens.
- Produces: touch-first control groups, adaptive participant/content panels, safe-area meeting controls, responsive ringer overlay.

- [ ] **Step 1: Implement presentation changes only**

Do not change any function/RPC call used to create/join/end a room or call. Keep event/session hooks intact.

- [ ] **Step 2: Run focused GREEN**

```bash
node --test scripts/room7-responsive.test.mjs scripts/chat-calls.test.mjs
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Manual Room7 smoke**

Verify internal Room7 at 360 portrait, 430 portrait, 768 portrait, 1024 landscape, 1280 desktop. Check controls, participant/content panel, call end, scroll, rotation.

- [ ] **Step 4: Commit**

Stage only files in this task and tests; commit `feat: polish responsive Room7 workspace`.

### Task 3: Migrate public Room7 shell without crossing the security boundary

**Files:**
- Modify: `src/room7-public/ExternalRoom7App.tsx`
- Modify: `src/room7-public/room7-public.css`
- Modify: `src/room7-public/Room7Install.tsx` only if compact install UI needs layout changes.
- Test: `scripts/room7-responsive.test.mjs`
- Test: existing Room7 public/security tests in the repository.

**Interfaces:**
- Consumes: existing public Room7 entry/lazy boundary.
- Produces: responsive guest/join/install shell with no auth/session semantic change.

- [ ] **Step 1: Extend RED for compact guest flow**

Assert guest access form/actions and install affordance have compact layout markers and no fixed min-width that exceeds compact mode.

- [ ] **Step 2: Verify RED**

Run `node --test scripts/room7-responsive.test.mjs` plus the repository's existing Room7 public/security test files identified by `git ls-files 'scripts/*room7*.test.mjs'`.
Expected: only new responsive assertions fail.

- [ ] **Step 3: Implement layout changes**

Keep invite-token handling, sessionStorage, URL cleanup, function endpoints, and lazy meeting loading unchanged.

- [ ] **Step 4: Full communication gate**

```bash
node --test scripts/room7-responsive.test.mjs scripts/chat-calls.test.mjs
npm run typecheck
npm test
npm run build
git diff --check
```
Then run every existing `scripts/*room7*.test.mjs` file.
Expected: PASS.

- [ ] **Step 5: Manual public Room7 matrix**

Verify guest/join/install states at 320, 390, 430, 768, 820, 1024, 1440 and at least one phone landscape state.

- [ ] **Step 6: Commit**

Stage exact modified public Room7 paths and responsive tests only; commit `feat: refine responsive Room7 guest experience`.

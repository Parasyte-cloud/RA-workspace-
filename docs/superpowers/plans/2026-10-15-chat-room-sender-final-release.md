# Chat Room Sender Identity and Final Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visible sender names to incoming room messages without changing direct-message or Chat semantics, then run rigorous cross-app responsive QA and release the completed redesign through PR/CI/squash merge.

**Architecture:** Keep existing `peopleMap` sender resolution and message rendering pipeline. Add a minimal room-only sender-label decision derived from current/previous rendered message context; style it in `src/chat.css`. Then run focused Chat regression, full project verification, viewport QA, guarded push/PR/merge, and synchronize local `main`.

**Tech Stack:** React, TypeScript, CSS, Node test runner, Git, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-10-15-ra-workspace-responsive-liquid-glass-design.md`

## Global Constraints

- Do not modify Partnership authorization or Chat membership rules.
- Do not change message send RPCs, mentions, attachments, calls, receipts, unread logic, edit/delete rules, or Enter/Return behavior.
- Sender label is visible only for incoming room/group messages, not direct messages and not own messages.
- Consecutive incoming room messages from the same sender suppress redundant labels when no day/call/system row separates the messages.
- Missing profile lookup uses existing `displayName(...)` fallback; never show raw UUIDs.
- Final release must not force-merge failed CI or requested changes.

## Review Focus

- Realtime incoming message from a different sender starts a new visible sender group without refresh.
- Day/call/system divider resets sender grouping.
- Long sender display name wraps/truncates without pushing message actions off-screen.
- Room label logic does not appear in DMs or current user's own bubbles.
- Existing receipt icons/action buttons remain accessible and visually stable beside the new label.

---

### Task 1: Write RED sender-name regression tests

**Files:**
- Create: `scripts/chat-room-sender-name.test.mjs`
- Modify: `scripts/run-tests.mjs` only if required by explicit registration.
- Inspect/retain: `scripts/chat-shell.test.mjs`, `scripts/chat-room-ui.test.mjs`, `scripts/chat-receipts.test.mjs`, `scripts/chat-composer-enter.test.mjs`.

**Interfaces:**
- Consumes: current `src/chat/ChatShell.tsx`, `src/chat.css`.
- Produces: regression contract for visible room sender identity and suppression rules.

- [ ] **Step 1: Write tests before production code**

Test names/assertions:
- `incoming room messages render a visible sender label`
- `direct messages do not render the room sender label`
- `own room messages do not render the sender label`
- `adjacent room messages from the same sender suppress the repeated label`
- `a day call or system row resets sender grouping`
- `existing receipt and message action markers remain present`

Prefer testing an extracted pure decision helper if ChatShell currently has no testable boundary. The production change that makes the first five tests pass must be a sender-label decision plus visible markup, not test-only regex exemptions.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/chat-room-sender-name.test.mjs
```
Expected: FAIL because visible room sender labels/grouping do not yet exist.

### Task 2: Implement minimal room sender labeling

**Files:**
- Modify: `src/chat/ChatShell.tsx`
- Modify: `src/chat.css`
- Create or modify: `src/chat/messages/senderGrouping.ts` only if a pure helper is needed to keep ChatShell manageable.
- Test: `scripts/chat-room-sender-name.test.mjs`

**Interfaces:**
- Consumes: `selectedRoom`, current rendered row sequence, existing `peopleMap`, existing `displayName` fallback.
- Produces: `shouldShowRoomSenderLabel(...) -> boolean` if extracted, and visible `.cmSenderName` markup above incoming room bubble content.

- [ ] **Step 1: Implement the smallest sender grouping rule**

A label is shown when the current message is incoming, the selected conversation is a room, and the immediately previous rendered message is absent, non-message, or has a different sender. Do not add time-gap grouping unless the current Chat model already exposes it cleanly.

- [ ] **Step 2: Add readable responsive styling**

`.cmSenderName` must use a compact readable size, accent/text token, max width/overflow handling, and enough spacing to distinguish identity without making the bubble visually heavy.

- [ ] **Step 3: Run GREEN**

```bash
node --test scripts/chat-room-sender-name.test.mjs
```
Expected: PASS.

- [ ] **Step 4: Run focused Chat regression**

```bash
node --test \
  scripts/chat-room-sender-name.test.mjs \
  scripts/chat-shell.test.mjs \
  scripts/chat-room-ui.test.mjs \
  scripts/chat-receipts.test.mjs \
  scripts/chat-composer-enter.test.mjs \
  scripts/chat-api.test.mjs \
  scripts/chat-basics.test.mjs \
  scripts/chat-collaboration.test.mjs \
  scripts/chat-message-security.test.mjs \
  scripts/chat-notifications.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Manual Chat matrix**

At 320, 360, 375, 390, 430, 768 portrait, 820 portrait, 1024 landscape, 1280, and 1440 verify room thread, DM thread, long sender name, adjacent same-sender messages, divider reset, reply/edit/delete, attachments/image/audio, receipts, mentions, unread state, call rows, details view, composer keyboard open/closed, orientation, older loading, empty room, realtime incoming message.

- [ ] **Step 6: Commit**

```bash
git add -- \
  src/chat/ChatShell.tsx \
  src/chat.css \
  scripts/chat-room-sender-name.test.mjs
```
If `src/chat/messages/senderGrouping.ts` was created, stage it explicitly too. Run `git diff --cached --check`, inspect names, then commit `feat(chat): show sender names in rooms`.

### Task 3: Final cross-app verification

**Files:** No product changes unless verification reveals a regression; any regression fix must get its own failing test first and separate explicit commit.

**Interfaces:**
- Consumes: complete feature branch.
- Produces: verified release candidate.

- [ ] **Step 1: Confirm branch safety**

```bash
git branch --show-current
git status --short
git log --oneline --decorate -8
```
Expected: `feat/responsive-liquid-glass-ui`; only known protected unrelated untracked artifacts, if any, remain outside commits.

- [ ] **Step 2: Run static/diff gates**

```bash
git diff --check origin/main...HEAD
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Run full automated suite**

```bash
npm test
npm run build
```
Also run any Supabase/local test command already present in `package.json` if it is part of normal CI for this repo; do not introduce a database mutation for a UI-only release.
Expected: PASS.

- [ ] **Step 4: Run focused responsive suites again**

```bash
node --test \
  scripts/responsive-shell.test.mjs \
  scripts/phone-shell.test.mjs \
  scripts/workspace-nav.test.mjs \
  scripts/responsive-core-modules.test.mjs \
  scripts/room7-responsive.test.mjs \
  scripts/chat-room-sender-name.test.mjs \
  scripts/chat-shell.test.mjs \
  scripts/chat-room-ui.test.mjs \
  scripts/chat-receipts.test.mjs \
  scripts/chat-composer-enter.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Complete the full viewport matrix**

Phones: 320, 360, 375, 390, 430.
Tablets/iPads: 768 portrait, 810 portrait, 820 portrait, 1024 landscape plus one representative landscape state.
Desktop/laptop: 1280, 1440, >=1600 where practical.
Record each checked surface in `docs/qa/2026-10-15-responsive-liquid-glass-qa.md` with PASS/issue notes; screenshots may remain local unless the repository already stores visual QA artifacts.

- [ ] **Step 6: Verify no unintended backend/schema changes**

```bash
BACKEND_DIFF="$(git diff --name-only origin/main...HEAD | grep -E '^supabase/(migrations|functions)/' || true)"
if [ -n "$BACKEND_DIFF" ]; then
  echo "STOP: unexpected backend change in UI redesign"
  printf '%s\n' "$BACKEND_DIFF"
  exit 1
fi
```
Expected: no backend migration/function paths from this project.

- [ ] **Step 7: Commit QA record**

```bash
git add -- docs/qa/2026-10-15-responsive-liquid-glass-qa.md
git diff --cached --check
git commit -m "test: record responsive redesign QA"
```

### Task 4: Push branch, open PR, pass CI, squash merge, sync main

**Files:** No new product files.

**Interfaces:**
- Consumes: verified release candidate.
- Produces: merged `main` and synchronized local checkout.

- [ ] **Step 1: Push exact feature branch**

```bash
git push -u origin feat/responsive-liquid-glass-ui
```
Then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/feat/responsive-liquid-glass-ui` and stop on mismatch.

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --repo Parasyte-cloud/RA-workspace- \
  --base main \
  --head feat/responsive-liquid-glass-ui \
  --title "Redesign RA Workspace responsive liquid glass UI" \
  --body-file docs/qa/2026-10-15-responsive-liquid-glass-qa.md
```
If the QA document is too terse for a PR body, create a temporary PR body from the committed spec summary plus QA results; do not expose secrets.

- [ ] **Step 3: Watch CI**

Resolve PR number with `gh pr view --json number --jq '.number'`, then:
```bash
gh pr checks <PR_NUMBER> --repo Parasyte-cloud/RA-workspace- --watch
```
Expected: all required checks PASS. Stop on failure.

- [ ] **Step 4: Confirm mergeability/review state**

```bash
gh pr view <PR_NUMBER> \
  --repo Parasyte-cloud/RA-workspace- \
  --json state,mergeable,reviewDecision,statusCheckRollup,url
```
Required: state OPEN, mergeable MERGEABLE, reviewDecision not CHANGES_REQUESTED, required checks successful.

- [ ] **Step 5: Squash merge without forcing**

```bash
gh pr merge <PR_NUMBER> \
  --repo Parasyte-cloud/RA-workspace- \
  --squash
```
Do not use admin/force bypass for failed policy checks.

- [ ] **Step 6: Verify remote merge**

```bash
gh pr view <PR_NUMBER> \
  --repo Parasyte-cloud/RA-workspace- \
  --json state,mergedAt,mergeCommit,url
```
Required: `state` is `MERGED`.

- [ ] **Step 7: Synchronize local main**

```bash
git switch main
git fetch origin
git pull --ff-only origin main
git rev-list --left-right --count origin/main...HEAD
git log -1 --oneline --decorate
git status --short
```
Required: divergence output `0 0`; protected unrelated untracked artifacts remain untouched.

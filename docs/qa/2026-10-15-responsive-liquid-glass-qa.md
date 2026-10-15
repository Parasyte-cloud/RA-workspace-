# RA Workspace Responsive Liquid Glass QA

Date: 2026-10-15
Branch: `feat/responsive-liquid-glass-ui`
Base: `4ea7dac390296a4462e44cc1663dba4aaad999a9`

## Scope verified in the build sandbox

This release changes the RA Workspace presentation system across the application shell, navigation, dashboards, department/workstation surfaces, common data/form/file/admin surfaces, internal Room7, public Room7 guest/install surfaces, and Chat room sender identity. It intentionally does not change Partnership authorization, Supabase schema/functions, Chat message authorization, receipts, mentions, calls, attachments, unread logic, edit/delete rules, or Enter/Return semantics.

## Automated source-level verification

- Branch-wide responsive + Chat contract matrix: **PASS, 89/89**.
- All discovered Room7 suites: **PASS, 44/44**.
- Focused Chat regression after sender labels: **PASS, 51/51**.
- Sender-label contract: **PASS, 6/6**.
- Existing Chat call regression during Room7 work: **PASS, 18/18**.
- Changed Chat TypeScript syntax checks: **PASS**.
- Core responsive module TypeScript syntax checks: **PASS**.
- Branch `git diff --check`: **PASS**.
- Dark-appearance glass fallback regression: **PASS (RED -> GREEN during final review)**.
- Unexpected backend mutation check for `supabase/migrations` and `supabase/functions`: **PASS, none changed**.

## Full repository gate in this sandbox

`npm test` executed but cannot be treated as the release gate because the uploaded Git bundle contains source/history only and the sandbox cannot reach `registry.npmjs.org` to complete `npm ci`.

Observed result: **71/73 suites passed**. The two failures are sandbox-tooling failures, not assertion failures in the product changes:

- `finance-sheets.test.mjs`: the temporary local esbuild compatibility shim supports `transformSync` but intentionally does not implement `buildSync`.
- `late-booking.test.mjs`: direct Node execution in this incomplete dependency/tooling environment cannot load the referenced `.ts` file and reports `ERR_UNKNOWN_FILE_EXTENSION`.

`npm run typecheck` is **PENDING MAC FINAL GATE** because the incomplete sandbox `node_modules` is missing type packages including `node`, `react`, `react-dom`, `estree`, and related Babel types.

`npm run build` is **PENDING MAC FINAL GATE** because the incomplete sandbox dependency tree is missing the `sharp` package entrypoint used by `prepare-brand-assets.mjs`.

These are environment limitations and must not be converted into release PASS results until the commands succeed on the normal Mac checkout with dependencies installed.

## Manual viewport matrix - required before push

The build sandbox cannot launch the production Vite application with the real dependency tree, so the following visual checks are deliberately marked **PENDING MAC FINAL GATE** rather than assumed to pass.

| Viewport | Status | Required checks |
| --- | --- | --- |
| 320 phone portrait | PENDING | shell/nav, forms, tables/cards, Chat list/thread/details, long sender, composer keyboard |
| 360 phone portrait | PENDING | same plus touch targets and sheets |
| 375 phone portrait | PENDING | same plus safe-area behavior |
| 390 phone portrait | PENDING | same plus Room7 controls |
| 430 large phone | PENDING | same plus dashboard/card density |
| 768 tablet portrait | PENDING | navigation rail, split layouts, Chat, Room7 |
| 810 tablet portrait | PENDING | forms/data surfaces and navigation transitions |
| 820 tablet portrait | PENDING | dashboard/workstation reflow and Chat details |
| 1024 tablet landscape | PENDING | wide transition, rail/sidebar, Room7, Chat panes |
| 1280 laptop | PENDING | desktop hierarchy, tables, dashboards, Chat |
| 1440 desktop | PENDING | desktop hierarchy, whitespace, glass/readability |
| >=1600 desktop | PENDING | max-width/readability and no stretched work surfaces |

For Chat specifically verify room and DM threads, long sender names, adjacent same-sender suppression, day/call divider reset, reply/edit/delete, images/files/audio, receipts, mentions, unread state, call rows, details view, composer with keyboard open/closed, older history, empty room, and realtime incoming messages. Sender names must appear only for incoming room messages, never DMs or the current user's own messages.

## Visual/accessibility checks - required before push

- No page-level horizontal overflow at compact widths.
- Primary actions remain reachable with the mobile keyboard open.
- Touch targets remain comfortable and no essential action depends on hover.
- Safe-area insets protect bottom navigation, composer, Room7 controls, and floating call UI.
- Liquid-glass surfaces retain readable contrast; non-backdrop-filter fallback remains usable.
- Reduced-motion mode removes non-essential animation without hiding state changes.
- Long names, filenames, URLs, and table values do not cover primary controls.
- Tablet portrait/landscape transitions do not leave duplicated or unreachable navigation controls.

## Final release gate on the normal Mac checkout

Before any push, the release workflow must run from the imported feature branch with the normal dependency tree available:

```bash
npm ci
npm test
npm run typecheck
npm run build
git diff --check main...HEAD
```

All commands must exit zero. Then complete the manual viewport matrix above. Do not push, open a PR, or merge if any gate is red.

## Release policy

After the Mac gates pass, push only `feat/responsive-liquid-glass-ui`, open a PR to `main`, wait for all required GitHub checks, verify the PR is mergeable and not in `CHANGES_REQUESTED`, squash merge without admin/force bypass, then fast-forward the local `main` and confirm `origin/main...HEAD` is `0 0`.

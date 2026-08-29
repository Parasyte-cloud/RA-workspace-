# RideArrivo Critical Runtime Stability Release

Date: 2026-08-29

## Objective

Remove the high-confidence runtime defects that could make Support or other workstations flash, blank, render stale data, or lose the permanent application shell during lazy loading and background refreshes.

## Support root causes fixed

- The application header and permanent shell no longer sit inside the route-level Suspense boundary. Lazy route loading can no longer replace the entire workstation shell.
- Route failures are contained by a route-level error boundary so a module failure does not take down navigation or the header.
- Support is loaded as one route boundary rather than independently lazy-loading both the department wrapper and Support execution module.
- Support tab requests are sequenced. A slow response from a previously selected tab cannot overwrite the currently selected tab.
- Each Support view keeps a last-known-good snapshot. Background refresh and transient upstream failures no longer blank valid Support data.
- Department workspace inputs are normalized to stable dependencies, preventing refetch loops caused by new inline array identities on parent renders.
- Department-space bootstrap runs once per mounted department workspace rather than on ordinary refreshes.
- The RideArrivo Support client deduplicates identical in-flight browser requests and applies a 20-second client timeout.
- The Support Edge Function now aligns authorization with the workspace model: Support, Manager, Admin, or an explicit active Support workstation assignment.
- The Support Edge Function shares concurrent backend logins, applies a 15-second upstream timeout, invalidates/retries an expired upstream token once, and sanitizes unexpected upstream responses.

## Whole-application stability fixes

- One desktop application-shell scroll owner is enforced by `shell-stability.css`; the sidebar and outer shell are not independent desktop scroll containers.
- Route navigation resets the content scroll position without moving the permanent shell.
- `DataWorkbench` preserves the previous successful dataset while refreshing and ignores stale responses.
- Shared Workspaces preserves the hydrated hub during realtime/background refreshes and guards against stale space responses.
- Work Desk preserves existing work during realtime refresh and ignores stale responses.
- Work Item details guard against stale item responses and preserve successful sub-panels when another query fails.
- Projects ignore stale project/list responses when the employee switches quickly.
- Finance Payments preserves the last successful provider snapshot and ignores stale date-range responses.
- Notifications no longer disappear during realtime/background refreshes.
- Pulse/Social preserves the last successful feed during refresh/action failures and ignores stale feed responses.

## Deployment impact

- No Supabase database migration is added by this release.
- Redeploy the `ridearrivo-support` Edge Function after the frontend build passes.
- The existing `finance-payments` deployment and previously applied migrations remain unchanged.
- The earlier `RideArrivo_scroll_architecture_stability_fix_20260829.zip` contained an extra top-level directory. Remove that accidental nested directory from the repo if it exists; this release includes the corrected root-level shell files.
- This corrected package also includes `src/workflow.css`, so applying the runtime stability release cannot leave `src/main.tsx` with a missing stylesheet import.

## Required release gates

1. `git diff --check`
2. `npm run build`
3. `npm run gateway:test` (14/14 expected)
4. `supabase db push --linked --dry-run` (remote up to date expected)
5. `supabase db lint --linked --schema public --level error`
6. `supabase functions deploy ridearrivo-support`
7. Support smoke test with an authorized Support user and an unauthorized ordinary employee.

## Support acceptance test

- Open Support and leave the Support Queue visible for at least 60 seconds: no shell/header flash and no full-list blanking.
- Switch Support tabs rapidly: the final selected tab must retain the correct data.
- Click Refresh with records visible: records stay visible and only the refresh affordance indicates activity.
- Temporarily lose network/upstream access: the last successful snapshot remains visible with an error notice.
- Restore connectivity and refresh: live data recovers without remounting the workspace.
- A user with an active Support workstation assignment can use Support even if their base role is not `support`.
- An ordinary employee without Support role/assignment receives a 403 from the Support Edge Function.

## Validation performed before packaging

- TypeScript/TSX parser audit across the modified application and Support Edge Function: no syntax diagnostics.
- Relative import audit: no missing local imports.
- Conflict-marker audit: clean.
- Obvious embedded private-key/payment-key pattern audit: clean.

A static/source audit cannot prove that every possible application bug is eliminated. The production build, gateway tests, database lint, Edge Function deployment, and targeted runtime smoke tests are the authoritative release gates.

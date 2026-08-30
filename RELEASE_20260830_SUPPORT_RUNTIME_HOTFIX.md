# RideArrivo Support Runtime Hotfix

Date: 2026-08-30

This corrected repository-root overlay supersedes the earlier critical runtime package.

## Fixes included

- Restores `src/workflow.css` and `src/theme-audit.css`, both required by `src/main.tsx`.
- Includes the root-level shell/runtime stability files; no extra wrapper directory is used.
- Keeps the Support workstation under a single lazy route and route-level error boundary.
- Preserves Support data during background refreshes and guards against stale responses.
- Stabilizes department workspace loading and generic `DataWorkbench` refreshes.
- Fixes Service Quality Reviews ordering: the table has `reviewed_at`, not `created_at`.
- Includes the hardened `ridearrivo-support` Edge Function with authorization alignment, login deduplication, timeout, retry and response sanitization.

## Cleanup required before applying

Remove the accidentally tracked wrapper directory from the earlier scroll package:

```bash
git rm -r --cached --ignore-unmatch RideArrivo_scroll_architecture_stability_fix_20260829
rm -rf RideArrivo_scroll_architecture_stability_fix_20260829
```

Then unzip this overlay into the repository root.

## Release gates

```bash
git diff --check
npm run build
npm run gateway:test
supabase db push --linked --dry-run
supabase db lint --linked --schema public --level error
supabase functions deploy ridearrivo-support
```

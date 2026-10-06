# RideArrivo Critical Runtime / Support Repair

This repair overlay supersedes the earlier critical runtime/support overlay.

It includes the same runtime stability, Support route, request sequencing,
Support Edge Function, and shell stability changes, plus `src/workflow.css`.
The missing stylesheet caused Vite to fail resolving `./workflow.css` from
`src/main.tsx` on the local repository.

The accidental directory `RideArrivo_scroll_architecture_stability_fix_20260829/`
is not part of this archive and should be removed from Git and disk before the
final commit. The actual shell files are placed directly under `src/`.

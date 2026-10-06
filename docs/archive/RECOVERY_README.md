# RideArrivo missing CSS recovery

Restores `src/workflow.css` and `src/theme-audit.css`, which are imported by `src/main.tsx` and were present in the known-good RideArrivo workspace baseline.

This recovery package does not alter database migrations, gateway code, or Supabase functions.

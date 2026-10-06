# RideArrivo Personalized Dashboard, KPI, Recognition and Finance Release

## Included

- Personalized employee Dashboard with time-aware greeting and daily named encouragement.
- Transparent rolling 30-day KPI and year-to-date/annual KPI for each employee.
- Admin KPI monitor for active employees; manager/direct-report visibility remains server-controlled.
- Monthly Top Performer recognition based on the previous closed calendar month.
- Winner badge remains active until a new eligible monthly winner is generated.
- Automatic company announcement and winner notification.
- Final previous-year KPI refresh on 1 January so annual records close cleanly.
- Admin-managed primary workstation assignment/reassignment, including Administration workstation for Admin.
- Unified Forgot / Reset Password recovery control.
- Native read-only Paystack and Flutterwave Finance panel through a Supabase Edge Function.

## KPI methodology

The operational delivery score uses recorded assigned work only:

- Completion: 60%
- Acknowledgement: 10%
- On-time completion: 30% when deadline-bearing completed work exists

If there is no assigned work, the score is `insufficient_data`, never a synthetic zero. Monthly recognition requires at least three assigned work items in the closed performance month. Ties are resolved deterministically by score, on-time completion, completed work, overdue work and employee ID.

KPI output is a coaching, workload and recognition signal. It does not automate compensation, promotion, discipline or termination decisions.

## Production order

1. Apply this overlay to the current repository.
2. Run `git diff --check`, `npm ci`, `npm run build` and `npm run gateway:test`.
3. Run `supabase db push --linked --dry-run` and verify only the intended pending migrations.
4. Apply the migrations and run linked DB lint.
5. Set Paystack/Flutterwave secrets in Supabase without exposing them to Vite or browser code.
6. Deploy the `finance-payments` Edge Function.
7. Re-run build/tests, commit, rebase from `origin/main`, and push.

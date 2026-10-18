# Data allocation (Administration > Data Allocation)

Everyone works remotely on their own connection, so the daily allowance is delivered by
**buying each person's bundle straight into their own MTN number** every morning. You decide
who gets 500 MB, 1 GB, 2 GB, 3 GB or 5 GB; the workspace buys it, records it and stops when the
pool or the day's spending limit runs out.

```
Administration > Data Allocation            VTpass (data reseller)             MTN
  plans, numbers, bundles, limit  ---->  Edge Function data-topup  ---->  buys the bundle  ---->  person's SIM
        pool and ledger (database)  <----  outcome of every order
```

The 1.5 TB is a **budget pool**: the total data you have set aside for staff. Each delivered bundle is
taken from it, and delivery stops when it is empty. The data itself comes from the VTpass wallet
(you pay per bundle), not from your 5G router. Your office 5G router is not part of this design: it
cannot reach people who are not on its Wi-Fi.

## Rules

- The day is the **Africa/Lagos** calendar day. Each person gets at most **one bundle per day**.
- Nothing is bought until an administrator switches delivery on **and** sets a daily spending limit in naira.
- The pool, the daily limit and "one per person per day" are enforced inside the database under a lock,
  so pressing Run now twice, or the schedule overlapping a manual run, cannot double-buy.
- If VTpass does not answer clearly (timeout, error, unknown reply) the order is **waiting**, never "failed".
  A waiting order is asked about again on every run and is never bought a second time.
  Only a clear refusal counts as failed, and a failed order is retried (new order id, up to 3 tries a day).
- If the VTpass wallet is empty or the keys are wrong, the run stops straight away and buys nothing else.
- If an order stays waiting, check VTpass, then press **It arrived** or **It did not** on that row.
- Unused data does not carry over. A suspended plan or a deactivated person gets nothing from the next run.
- Everything an administrator changes is in the audit trail. Phone numbers are shown masked
  (`0803 *** 4567`) and only the masked form is ever written to the audit trail.

## Set-up, step by step

### 1. VTpass account

Create a VTpass account, fund the wallet, and get the three keys from its dashboard (API keys page):
API key, public key (starts with `PK_`) and secret key (starts with `SK_`). Start in **sandbox**: it is a
separate account area on `sandbox.vtpass.com` where nothing real is bought. Sandbox treats the number
`08011111111` as a success and any other number as a failure, so test with that number.

If your live VTpass account restricts API access by IP address, note that Supabase Edge Functions do not
have a fixed IP address. Ask VTpass support about this before going live. If IP restriction is on, the
purchase code must instead run on a machine with a fixed IP (the same `dataTopupCore.ts` logic).

### 2. Database and functions

```bash
supabase db push                                      # applies 20261018010000_data_topups.sql
supabase secrets set VTPASS_ENV=sandbox               # sandbox first. Change to live only when ready.
supabase secrets set VTPASS_API_KEY=...  VTPASS_SECRET_KEY=...  VTPASS_PUBLIC_KEY=...
supabase functions deploy data-topup --no-verify-jwt
```

`--no-verify-jwt` is needed because the daily schedule has no workspace session. The function checks for
itself: it accepts only the cron secret (`CRON_DISPATCH_SECRET`, already used by the other scheduled
functions) or a signed-in workspace administrator.

The migration also schedules the run at **05:00, 06:00 and 08:00 Lagos time** (pg_cron). The later runs only
retry failures and re-check waiting orders. If pg_cron, pg_net or the Vault secret `cron_dispatch_secret`
are not set up, the schedule is skipped with a notice and **Run now** still works; the existing
`cron_authentication_status()` function shows whether the cron secret is in place.

### 3. Configure it on screen

1. Open Administration > Data Allocation. Add the pool (the **1.5 TB** button fills 1500 GB).
2. Give each person a daily plan.
3. Add each person's MTN number on their row, or paste `email, number` lines in the **MTN numbers** box.
4. In **Daily delivery**, press **Load bundles from VTpass** and pick the daily bundle for each plan
   (check the price). Choose bundles that last one day, so what you deliver matches the plan.
5. Set the daily spending limit, then **Switch delivery on**.
6. Press **Run now**. In sandbox the message says "Test run". Check **Recent deliveries**.
7. When you are happy, run `supabase secrets set VTPASS_ENV=live`. The screen then shows **LIVE: real money is spent**
   and asks you to confirm before switching delivery on.

## What each part does if it breaks

| Failure | Result |
| --- | --- |
| VTpass wallet empty | The run stops at the first refusal, nothing else is bought, the screen shows the reason. Fund the wallet and press Run now. |
| VTpass slow or down | Orders become "waiting" and are re-checked on every run. Nobody is double-charged. |
| Workspace database down | Nothing is reserved, so nothing is bought. |
| Person has no number or no bundle for their plan | They are skipped and counted as "need a number" on the screen. |
| Wrong keys | The run stops at the first refusal. |
| Run twice, or schedule plus Run now | The second run finds everyone already delivered or waiting and buys nothing. |

## Check it yourself

- `supabase/checks/data-topups.sql`: 32 behaviour checks for the database rules (run on a scratch Postgres).
- `scripts/data-topup.test.mjs`: the purchase logic against a fake database and a fake reseller, and the screens.

## Files

- `supabase/migrations/20261018010000_data_topups.sql`: numbers, bundles, ledger, switch, limit, schedule
- `supabase/functions/data-topup/` and `_shared/dataTopupCore.ts`: the purchase function and its logic
- `src/modules/AdminDataDelivery.tsx`: delivery controls; `src/modules/AdminDataAllocation.tsx`: pool, plans, numbers
- `src/components/MyDataCard.tsx`: what each person sees on their dashboard

## Office gateway mode (optional, not used for remote staff)

The earlier FreeRADIUS design (`ops/freeradius/`, `data-radius`, migration `20261018000000`) meters
traffic at an office gateway. It only applies to people sitting on the office network, so it is not part of
the remote setup above. It stays in the repository, switched off, in case you need it for an office.

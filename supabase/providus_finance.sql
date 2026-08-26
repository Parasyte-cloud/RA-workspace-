-- RideArrivo Finance - Providus statement ledger
-- Run in Supabase SQL Editor.

create table if not exists public.finance_bank_imports (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null default 'Providus Bank',
  account_label text,
  file_name text not null,
  imported_by uuid references auth.users(id) on delete set null,
  transaction_count integer not null default 0 check (transaction_count >= 0),
  debit_total numeric(16,2) not null default 0 check (debit_total >= 0),
  credit_total numeric(16,2) not null default 0 check (credit_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.finance_bank_imports(id) on delete set null,
  bank_name text not null default 'Providus Bank',
  transaction_date date not null,
  value_date date,
  description text not null,
  reference text,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  balance numeric(16,2),
  category text not null default 'Uncategorised Expense',
  department text,
  vendor text,
  transaction_type text not null default 'other'
    check (transaction_type in ('expense','income','transfer','refund','bank_charge','payroll','other')),
  reconciliation_status text not null default 'unreconciled'
    check (reconciliation_status in ('unreconciled','review','reconciled')),
  expense_id uuid references public.finance_expenses(id) on delete set null,
  receipt_path text,
  notes text,
  source_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (debit > 0 or credit > 0)
);

create index if not exists idx_finance_bank_tx_date
  on public.finance_bank_transactions(transaction_date desc);
create index if not exists idx_finance_bank_tx_category
  on public.finance_bank_transactions(category, transaction_date desc);
create index if not exists idx_finance_bank_tx_reconciliation
  on public.finance_bank_transactions(reconciliation_status, transaction_date desc);
create index if not exists idx_finance_bank_import_created
  on public.finance_bank_imports(created_at desc);

alter table public.finance_bank_imports enable row level security;
alter table public.finance_bank_transactions enable row level security;

drop policy if exists "finance bank import read" on public.finance_bank_imports;
drop policy if exists "finance bank import write" on public.finance_bank_imports;
drop policy if exists "finance bank transaction read" on public.finance_bank_transactions;
drop policy if exists "finance bank transaction write" on public.finance_bank_transactions;

create policy "finance bank import read"
on public.finance_bank_imports
for select to authenticated
using (public.has_workspace_role(array['finance','manager','admin']));

create policy "finance bank import write"
on public.finance_bank_imports
for all to authenticated
using (public.has_workspace_role(array['finance','admin']))
with check (public.has_workspace_role(array['finance','admin']));

create policy "finance bank transaction read"
on public.finance_bank_transactions
for select to authenticated
using (public.has_workspace_role(array['finance','manager','admin']));

create policy "finance bank transaction write"
on public.finance_bank_transactions
for all to authenticated
using (public.has_workspace_role(array['finance','admin']))
with check (public.has_workspace_role(array['finance','admin']));

grant select, insert, update, delete on public.finance_bank_imports to authenticated;
grant select, insert, update, delete on public.finance_bank_transactions to authenticated;
revoke all on public.finance_bank_imports from anon;
revoke all on public.finance_bank_transactions from anon;

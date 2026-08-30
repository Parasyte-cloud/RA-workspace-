begin;

-- ============================================================
-- OPERATIONS RECEIPTS & EXPENSE EVIDENCE
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public
)
values (
  'operations-receipts',
  'operations-receipts',
  false
)
on conflict (id) do update
set public = false;


create table if not exists public.operations_receipts (
  id uuid primary key default gen_random_uuid(),

  receipt_type text not null
    check (
      receipt_type in (
        'hardcopy_scan',
        'softcopy'
      )
    ),

  vendor_name text not null,
  receipt_date date not null,

  amount numeric(14,2) not null
    check (amount >= 0),

  currency text not null default 'NGN',

  expense_category text not null,

  description text,

  booking_reference text,
  vehicle_reference text,
  trip_reference text,

  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size bigint not null
    check (file_size > 0),

  status text not null default 'submitted'
    check (
      status in (
        'submitted',
        'under_review',
        'approved',
        'rejected',
        'voided'
      )
    ),

  submitted_by uuid not null
    references public.employee_profiles(id),

  submitted_at timestamptz not null default now(),

  reviewed_by uuid
    references public.employee_profiles(id),

  reviewed_at timestamptz,

  review_note text,

  voided_by uuid
    references public.employee_profiles(id),

  voided_at timestamptz,

  void_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table if not exists public.operations_receipt_audit (
  id bigint generated always as identity primary key,

  receipt_id uuid not null
    references public.operations_receipts(id),

  action text not null,

  actor_id uuid
    references public.employee_profiles(id),

  previous_data jsonb,
  new_data jsonb,

  created_at timestamptz not null default now()
);


create index if not exists idx_operations_receipts_status
on public.operations_receipts(
  status,
  submitted_at desc
);

create index if not exists idx_operations_receipts_submitter
on public.operations_receipts(
  submitted_by,
  submitted_at desc
);

create index if not exists idx_operations_receipts_date
on public.operations_receipts(
  receipt_date desc
);

create index if not exists idx_operations_receipt_audit
on public.operations_receipt_audit(
  receipt_id,
  created_at desc
);


-- ============================================================
-- UPDATED AT
-- ============================================================

create or replace function public.touch_operations_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


drop trigger if exists operations_receipt_touch
on public.operations_receipts;

create trigger operations_receipt_touch
before update
on public.operations_receipts
for each row
execute function public.touch_operations_receipt();


-- ============================================================
-- SERVER-CONTROLLED WORKFLOW
-- ============================================================

create or replace function public.enforce_operations_receipt_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_workspace_role();
begin
  if v_actor is null then
    raise exception
      'Authentication is required for receipt changes';
  end if;


  if TG_OP = 'INSERT' then
    if v_role not in (
      'operations',
      'finance',
      'admin'
    ) then
      raise exception
        'Operations, Finance or administrator access is required';
    end if;

    new.submitted_by := v_actor;
    new.submitted_at := now();
    new.status := 'submitted';

    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;

    new.voided_by := null;
    new.voided_at := null;
    new.void_reason := null;

    return new;
  end if;


  -- Approved / rejected / voided evidence cannot be edited.
  if old.status in (
    'approved',
    'rejected',
    'voided'
  ) then
    raise exception
      'Finalised receipt records cannot be modified';
  end if;


  -- Operations can edit metadata only before Finance review starts.
  if v_role = 'operations' then
    if old.submitted_by <> v_actor then
      raise exception
        'Operations users may only modify receipts they submitted';
    end if;

    if old.status <> 'submitted' then
      raise exception
        'Receipt metadata can only be corrected before Finance review';
    end if;

    if new.status <> old.status then
      raise exception
        'Operations users cannot change receipt review status';
    end if;

    new.submitted_by := old.submitted_by;
    new.submitted_at := old.submitted_at;

    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;

    new.voided_by := old.voided_by;
    new.voided_at := old.voided_at;
    new.void_reason := old.void_reason;

    return new;
  end if;


  if v_role not in (
    'finance',
    'admin'
  ) then
    raise exception
      'Finance or administrator access is required';
  end if;


  if new.status is distinct from old.status then

    if new.status = 'under_review' then
      if old.status <> 'submitted' then
        raise exception
          'Only submitted receipts can enter review';
      end if;

      if old.submitted_by = v_actor then
        raise exception
          'A receipt submitter cannot review their own receipt';
      end if;

      new.reviewed_by := v_actor;
      new.reviewed_at := now();


    elsif new.status in (
      'approved',
      'rejected'
    ) then
      if old.status <> 'under_review' then
        raise exception
          'Receipt must be under review before final decision';
      end if;

      if old.submitted_by = v_actor then
        raise exception
          'A receipt submitter cannot approve or reject their own receipt';
      end if;

      new.reviewed_by := v_actor;
      new.reviewed_at := now();


    elsif new.status = 'voided' then
      if new.void_reason is null
         or trim(new.void_reason) = '' then
        raise exception
          'A reason is required to void a receipt';
      end if;

      new.voided_by := v_actor;
      new.voided_at := now();


    else
      raise exception
        'Invalid receipt workflow transition';

    end if;
  end if;

  new.submitted_by := old.submitted_by;
  new.submitted_at := old.submitted_at;

  return new;
end;
$$;


drop trigger if exists operations_receipt_workflow
on public.operations_receipts;

create trigger operations_receipt_workflow
before insert or update
on public.operations_receipts
for each row
execute function public.enforce_operations_receipt_workflow();


-- ============================================================
-- IMMUTABLE AUDIT
-- ============================================================

create or replace function public.capture_operations_receipt_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.operations_receipt_audit(
    receipt_id,
    action,
    actor_id,
    previous_data,
    new_data
  )
  values(
    new.id,
    TG_OP,
    auth.uid(),
    case
      when TG_OP='UPDATE'
      then to_jsonb(old)
      else null
    end,
    to_jsonb(new)
  );

  return new;
end;
$$;


drop trigger if exists operations_receipt_audit_trigger
on public.operations_receipts;

create trigger operations_receipt_audit_trigger
after insert or update
on public.operations_receipts
for each row
execute function public.capture_operations_receipt_audit();


-- ============================================================
-- RLS
-- ============================================================

alter table public.operations_receipts
enable row level security;

alter table public.operations_receipt_audit
enable row level security;


drop policy if exists "operations receipts read"
on public.operations_receipts;

create policy "operations receipts read"
on public.operations_receipts
for select
to authenticated
using (
  public.has_workspace_role(
    array['operations','finance','manager','admin']
  )
);


drop policy if exists "operations receipts insert"
on public.operations_receipts;

create policy "operations receipts insert"
on public.operations_receipts
for insert
to authenticated
with check (
  public.has_workspace_role(
    array['operations','finance','admin']
  )
);


drop policy if exists "operations receipts update"
on public.operations_receipts;

create policy "operations receipts update"
on public.operations_receipts
for update
to authenticated
using (
  public.has_workspace_role(
    array['operations','finance','admin']
  )
)
with check (
  public.has_workspace_role(
    array['operations','finance','admin']
  )
);


drop policy if exists "operations receipt audit read"
on public.operations_receipt_audit;

create policy "operations receipt audit read"
on public.operations_receipt_audit
for select
to authenticated
using (
  public.has_workspace_role(
    array['finance','admin']
  )
);


-- ============================================================
-- STORAGE POLICIES
-- ============================================================

drop policy if exists "operations receipts storage read"
on storage.objects;

create policy "operations receipts storage read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'operations-receipts'
  and public.has_workspace_role(
    array['operations','finance','manager','admin']
  )
);


drop policy if exists "operations receipts storage upload"
on storage.objects;

create policy "operations receipts storage upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'operations-receipts'
  and public.has_workspace_role(
    array['operations','finance','admin']
  )
);


-- No UPDATE or DELETE storage policy.
-- Receipt evidence is append-only once uploaded.


-- ============================================================
-- DATA API PRIVILEGES
-- ============================================================

grant select,insert,update
on public.operations_receipts
to authenticated;

grant select
on public.operations_receipt_audit
to authenticated;

revoke delete
on public.operations_receipts
from authenticated;

revoke insert,update,delete
on public.operations_receipt_audit
from authenticated;

revoke all
on public.operations_receipts,
   public.operations_receipt_audit
from anon;


revoke all
on function public.touch_operations_receipt()
from public,anon;

revoke all
on function public.enforce_operations_receipt_workflow()
from public,anon;

revoke all
on function public.capture_operations_receipt_audit()
from public,anon;


commit;

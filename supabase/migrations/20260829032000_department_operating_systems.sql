begin;

-- Support operating system
create table if not exists public.support_macros(
  id uuid primary key default gen_random_uuid(), title text not null, category text not null default 'general', response_text text not null,
  active boolean not null default true, created_by uuid references public.employee_profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.support_handovers(
  id uuid primary key default gen_random_uuid(), shift_label text not null, summary text not null, open_items text, priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
  status text not null default 'open' check(status in ('open','acknowledged','closed')), owner_id uuid references public.employee_profiles(id), created_by uuid references public.employee_profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.support_quality_reviews(
  id uuid primary key default gen_random_uuid(), case_reference text not null, score integer check(score between 1 and 5), review_notes text, reviewed_by uuid references public.employee_profiles(id), reviewed_at timestamptz not null default now()
);

-- Operations operating system
create table if not exists public.operations_driver_shifts(
  id uuid primary key default gen_random_uuid(), driver_name text not null, shift_date date not null, start_time time, end_time time, vehicle_reference text,
  status text not null default 'planned' check(status in ('planned','confirmed','active','completed','cancelled')), notes text, created_at timestamptz not null default now()
);
create table if not exists public.operations_fleet_maintenance(
  id uuid primary key default gen_random_uuid(), vehicle_reference text not null, maintenance_type text not null, due_date date, odometer_due integer,
  status text not null default 'scheduled' check(status in ('scheduled','due','in_service','complete','overdue')), vendor text, cost numeric(14,2), notes text, created_at timestamptz not null default now()
);
create table if not exists public.operations_vehicle_inspections(
  id uuid primary key default gen_random_uuid(), vehicle_reference text not null, inspection_date date not null default current_date, inspector text not null,
  overall_status text not null default 'pass' check(overall_status in ('pass','attention','fail')), defects text, follow_up_due date, created_at timestamptz not null default now()
);
create table if not exists public.operations_flight_watch(
  id uuid primary key default gen_random_uuid(), booking_reference text, flight_number text not null, airline text, scheduled_arrival timestamptz, terminal text,
  status text not null default 'scheduled', last_checked_at timestamptz, notes text, created_at timestamptz not null default now()
);

-- People operating system
create table if not exists public.people_candidates(
  id uuid primary key default gen_random_uuid(), full_name text not null, email text, phone text, role_title text not null, stage text not null default 'applied' check(stage in ('applied','screening','interview','assessment','offer','hired','rejected','withdrawn')),
  source text, interview_date timestamptz, owner_id uuid references public.employee_profiles(id), notes text, created_at timestamptz not null default now()
);
create table if not exists public.people_performance_reviews(
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employee_profiles(id) on delete cascade, review_period text not null,
  rating numeric(3,1), status text not null default 'draft' check(status in ('draft','employee_input','manager_review','calibration','complete')), goals text, manager_notes text, review_date date, created_at timestamptz not null default now()
);
create table if not exists public.people_training_records(
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employee_profiles(id) on delete cascade, training_name text not null, provider text,
  status text not null default 'assigned' check(status in ('assigned','in_progress','completed','expired')), due_date date, completed_at timestamptz, certificate_path text, created_at timestamptz not null default now()
);

-- Legal and privacy operating system
create table if not exists public.legal_requests(
  id uuid primary key default gen_random_uuid(), title text not null, requester_id uuid references public.employee_profiles(id), request_type text not null, priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
  status text not null default 'open' check(status in ('open','triage','in_review','waiting','complete','closed')), owner_id uuid references public.employee_profiles(id), due_date date, summary text, created_at timestamptz not null default now()
);
create table if not exists public.privacy_requests(
  id uuid primary key default gen_random_uuid(), request_type text not null, data_subject_reference text not null, status text not null default 'received' check(status in ('received','identity_verification','in_progress','extended','complete','rejected')),
  owner_id uuid references public.employee_profiles(id), received_at timestamptz not null default now(), due_date date, resolution_notes text, created_at timestamptz not null default now()
);
create table if not exists public.regulatory_filings(
  id uuid primary key default gen_random_uuid(), regulator text not null, filing_name text not null, period_label text, due_date date not null,
  status text not null default 'open' check(status in ('open','preparing','review','filed','accepted','overdue')), evidence_path text, owner_id uuid references public.employee_profiles(id), created_at timestamptz not null default now()
);

-- Executive operating system
create table if not exists public.executive_priorities(
  id uuid primary key default gen_random_uuid(), title text not null, objective text, owner text, quarter text, due_date date,
  status text not null default 'on_track' check(status in ('on_track','at_risk','blocked','complete')), progress integer not null default 0 check(progress between 0 and 100), created_at timestamptz not null default now()
);
create table if not exists public.executive_decisions(
  id uuid primary key default gen_random_uuid(), title text not null, decision text not null, rationale text, owner text, decision_date date not null default current_date, review_date date, created_at timestamptz not null default now()
);
create table if not exists public.enterprise_risks(
  id uuid primary key default gen_random_uuid(), risk_title text not null, category text not null, likelihood text not null, impact text not null, owner text,
  mitigation text, status text not null default 'open' check(status in ('open','mitigating','accepted','closed')), review_date date, created_at timestamptz not null default now()
);

-- RLS helpers by table groups
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_macros','support_handovers','support_quality_reviews'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
    EXECUTE format('drop policy if exists "support os read" on public.%I',t);
    EXECUTE format('drop policy if exists "support os write" on public.%I',t);
    EXECUTE format('create policy "support os read" on public.%I for select to authenticated using(public.has_workspace_role(array[''support'',''manager'',''admin'']))',t);
    EXECUTE format('create policy "support os write" on public.%I for all to authenticated using(public.has_workspace_role(array[''support'',''manager'',''admin''])) with check(public.has_workspace_role(array[''support'',''manager'',''admin'']))',t);
    EXECUTE format('grant select,insert,update,delete on public.%I to authenticated',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['operations_driver_shifts','operations_fleet_maintenance','operations_vehicle_inspections','operations_flight_watch'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
    EXECUTE format('drop policy if exists "operations os read" on public.%I',t);
    EXECUTE format('drop policy if exists "operations os write" on public.%I',t);
    EXECUTE format('create policy "operations os read" on public.%I for select to authenticated using(public.has_workspace_role(array[''operations'',''manager'',''admin'']))',t);
    EXECUTE format('create policy "operations os write" on public.%I for all to authenticated using(public.has_workspace_role(array[''operations'',''manager'',''admin''])) with check(public.has_workspace_role(array[''operations'',''manager'',''admin'']))',t);
    EXECUTE format('grant select,insert,update,delete on public.%I to authenticated',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['people_candidates','people_performance_reviews','people_training_records'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
    EXECUTE format('drop policy if exists "people os read" on public.%I',t);
    EXECUTE format('drop policy if exists "people os write" on public.%I',t);
    EXECUTE format('create policy "people os read" on public.%I for select to authenticated using(public.has_workspace_role(array[''hr'',''manager'',''admin'']))',t);
    EXECUTE format('create policy "people os write" on public.%I for all to authenticated using(public.has_workspace_role(array[''hr'',''manager'',''admin''])) with check(public.has_workspace_role(array[''hr'',''manager'',''admin'']))',t);
    EXECUTE format('grant select,insert,update,delete on public.%I to authenticated',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['legal_requests','privacy_requests','regulatory_filings'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
    EXECUTE format('drop policy if exists "legal os read" on public.%I',t);
    EXECUTE format('drop policy if exists "legal os write" on public.%I',t);
    EXECUTE format('create policy "legal os read" on public.%I for select to authenticated using(public.has_workspace_role(array[''legal'',''manager'',''admin'']))',t);
    EXECUTE format('create policy "legal os write" on public.%I for all to authenticated using(public.has_workspace_role(array[''legal'',''admin''])) with check(public.has_workspace_role(array[''legal'',''admin'']))',t);
    EXECUTE format('grant select,insert,update,delete on public.%I to authenticated',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['executive_priorities','executive_decisions','enterprise_risks'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
    EXECUTE format('drop policy if exists "executive os read" on public.%I',t);
    EXECUTE format('drop policy if exists "executive os write" on public.%I',t);
    EXECUTE format('create policy "executive os read" on public.%I for select to authenticated using(public.has_workspace_role(array[''manager'',''admin'']))',t);
    EXECUTE format('create policy "executive os write" on public.%I for all to authenticated using(public.has_workspace_role(array[''manager'',''admin''])) with check(public.has_workspace_role(array[''manager'',''admin'']))',t);
    EXECUTE format('grant select,insert,update,delete on public.%I to authenticated',t);
  END LOOP;
END $$;

commit;

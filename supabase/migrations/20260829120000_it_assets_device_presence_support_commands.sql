-- RideArrivo IT asset registry, signed-in device presence and support command library.
-- Browser sessions can report browser/OS/screen/timezone and consented coarse location.
-- Web browsers cannot read a laptop/phone hardware serial number or IMEI; those identifiers
-- must be entered/verified by Administration/Support or supplied later by an approved MDM/agent.

begin;

create table if not exists public.company_devices (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null unique,
  assigned_employee_id uuid references public.employee_profiles(id) on delete set null,
  device_type text not null default 'laptop' check (device_type in ('laptop','desktop','phone','tablet','accessory','other')),
  manufacturer text,
  model text,
  serial_number text,
  imei text,
  color text,
  memory_label text,
  storage_label text,
  operating_system text,
  hostname text,
  location_label text,
  status text not null default 'assigned' check (status in ('inventory','assigned','repair','lost','retired','returned')),
  issued_at date,
  returned_at date,
  notes text,
  created_by uuid references public.employee_profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.employee_profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_devices_employee_idx
  on public.company_devices(assigned_employee_id)
  where assigned_employee_id is not null;

create index if not exists company_devices_status_idx
  on public.company_devices(status);

create unique index if not exists company_devices_serial_unique_idx
  on public.company_devices(serial_number)
  where serial_number is not null and btrim(serial_number)<>'';

create unique index if not exists company_devices_imei_unique_idx
  on public.company_devices(imei)
  where imei is not null and btrim(imei)<>'';

create table if not exists public.employee_device_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  browser_device_id text not null,
  browser_name text,
  operating_system text,
  platform text,
  user_agent text,
  screen_width integer,
  screen_height integer,
  hardware_concurrency integer,
  device_memory_gb numeric(5,2),
  timezone text,
  latitude numeric(7,2),
  longitude numeric(7,2),
  location_accuracy_m integer,
  location_shared_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(employee_id,browser_device_id)
);

create index if not exists employee_device_sessions_employee_idx
  on public.employee_device_sessions(employee_id,last_seen_at desc);

create table if not exists public.support_command_library (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Device information',
  platform text not null default 'Any',
  command_text text not null,
  description text,
  risk_level text not null default 'safe' check (risk_level in ('safe','caution','admin')),
  active boolean not null default true,
  created_by uuid references public.employee_profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.employee_profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(title,platform)
);

create or replace function public.touch_it_registry_updated_at()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  return new;
end;
$$;

revoke all on function public.touch_it_registry_updated_at() from public;

DROP TRIGGER IF EXISTS company_devices_touch_updated_at ON public.company_devices;
create trigger company_devices_touch_updated_at
before update on public.company_devices
for each row execute function public.touch_it_registry_updated_at();

DROP TRIGGER IF EXISTS support_command_library_touch_updated_at ON public.support_command_library;
create trigger support_command_library_touch_updated_at
before update on public.support_command_library
for each row execute function public.touch_it_registry_updated_at();

alter table public.company_devices enable row level security;
alter table public.employee_device_sessions enable row level security;
alter table public.support_command_library enable row level security;

-- Employees may see only assets assigned to them. Support/Admin can manage the company registry.
drop policy if exists "company devices assigned employee read" on public.company_devices;
create policy "company devices assigned employee read"
on public.company_devices for select to authenticated
using (assigned_employee_id=auth.uid());

drop policy if exists "company devices support admin read" on public.company_devices;
create policy "company devices support admin read"
on public.company_devices for select to authenticated
using (public.current_workspace_role() in ('support','admin'));

drop policy if exists "company devices support admin insert" on public.company_devices;
create policy "company devices support admin insert"
on public.company_devices for insert to authenticated
with check (public.current_workspace_role() in ('support','admin'));

drop policy if exists "company devices support admin update" on public.company_devices;
create policy "company devices support admin update"
on public.company_devices for update to authenticated
using (public.current_workspace_role() in ('support','admin'))
with check (public.current_workspace_role() in ('support','admin'));

drop policy if exists "company devices support admin delete" on public.company_devices;
create policy "company devices support admin delete"
on public.company_devices for delete to authenticated
using (public.current_workspace_role() in ('support','admin'));

-- A signed-in employee may register/update only their own browser installation record.
drop policy if exists "device sessions self read" on public.employee_device_sessions;
create policy "device sessions self read"
on public.employee_device_sessions for select to authenticated
using (employee_id=auth.uid());

drop policy if exists "device sessions support admin read" on public.employee_device_sessions;
create policy "device sessions support admin read"
on public.employee_device_sessions for select to authenticated
using (public.current_workspace_role() in ('support','admin'));

drop policy if exists "device sessions self insert" on public.employee_device_sessions;
create policy "device sessions self insert"
on public.employee_device_sessions for insert to authenticated
with check (employee_id=auth.uid());

drop policy if exists "device sessions self update" on public.employee_device_sessions;
create policy "device sessions self update"
on public.employee_device_sessions for update to authenticated
using (employee_id=auth.uid())
with check (employee_id=auth.uid());

-- Approved troubleshooting commands are visible to Support/Engineering/Admin; only Support/Admin edit them.
drop policy if exists "support commands technical read" on public.support_command_library;
create policy "support commands technical read"
on public.support_command_library for select to authenticated
using (public.current_workspace_role() in ('support','engineer','cto','admin'));

drop policy if exists "support commands support admin insert" on public.support_command_library;
create policy "support commands support admin insert"
on public.support_command_library for insert to authenticated
with check (public.current_workspace_role() in ('support','admin'));

drop policy if exists "support commands support admin update" on public.support_command_library;
create policy "support commands support admin update"
on public.support_command_library for update to authenticated
using (public.current_workspace_role() in ('support','admin'))
with check (public.current_workspace_role() in ('support','admin'));

drop policy if exists "support commands support admin delete" on public.support_command_library;
create policy "support commands support admin delete"
on public.support_command_library for delete to authenticated
using (public.current_workspace_role() in ('support','admin'));

revoke all on public.company_devices from anon;
revoke all on public.employee_device_sessions from anon;
revoke all on public.support_command_library from anon;

grant select,insert,update,delete on public.company_devices to authenticated;
grant select,insert,update on public.employee_device_sessions to authenticated;
grant select,insert,update,delete on public.support_command_library to authenticated;

-- Safe, read-only starter commands. These never execute automatically in RideArrivo.
insert into public.support_command_library(title,category,platform,command_text,description,risk_level,active)
values
  ('Read Windows BIOS serial','Device information','Windows PowerShell','Get-CimInstance Win32_BIOS | Select-Object SerialNumber','Read the BIOS-reported serial number from a Windows PC.','safe',true),
  ('Read Windows device summary','Device information','Windows PowerShell','Get-ComputerInfo | Select-Object CsName,WindowsProductName,WindowsVersion,OsArchitecture,CsManufacturer,CsModel','Read hostname, Windows edition, architecture, manufacturer and model.','safe',true),
  ('Read macOS hardware serial','Device information','macOS','system_profiler SPHardwareDataType | awk ''/Serial Number/{print $4}''','Read the Apple hardware serial number.','safe',true),
  ('Read Linux hardware serial','Device information','Linux','cat /sys/class/dmi/id/product_serial','Read the DMI product serial where the hardware exposes it.','safe',true),
  ('Network route diagnostic','Network','Any','traceroute ridearrivo.com','Trace the network route to RideArrivo. On Windows use tracert ridearrivo.com.','safe',true)
on conflict(title,platform) do nothing;

commit;

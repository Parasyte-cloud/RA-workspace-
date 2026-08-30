-- RideArrivo Workspace
-- Restore the employee profile contract expected by the frontend.
-- Idempotent because production received this repair directly before it
-- was captured in the canonical migration history.

begin;

alter table public.employee_profiles
  add column if not exists phone text,
  add column if not exists whatsapp text,
  add column if not exists avatar_path text,
  add column if not exists office_address text,
  add column if not exists website text,
  add column if not exists linkedin_url text,
  add column if not exists x_url text,
  add column if not exists instagram_url text,
  add column if not exists bio text,
  add column if not exists working_hours text,
  add column if not exists virtual_card_enabled boolean not null default true,
  add column if not exists public_card_enabled boolean not null default false;

alter table public.employee_profiles
  alter column working_hours
  set default 'Mon - Fri: 9:00 AM - 5:00 PM';

update public.employee_profiles
set
  working_hours = 'Mon - Fri: 9:00 AM - 5:00 PM',
  updated_at = now()
where working_hours is null
   or btrim(working_hours) = ''
   or working_hours = 'Mon - Fri: 9:00 AM - 6:00 PM';

create or replace function public.update_my_employee_profile(
  p_phone text default null,
  p_whatsapp text default null,
  p_avatar_path text default null,
  p_linkedin_url text default null,
  p_bio text default null,
  p_office_address text default null,
  p_website text default null,
  p_x_url text default null,
  p_instagram_url text default null,
  p_working_hours text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.employee_profiles
  set
    phone = nullif(btrim(p_phone), ''),
    whatsapp = nullif(btrim(p_whatsapp), ''),
    avatar_path = nullif(btrim(p_avatar_path), ''),
    linkedin_url = nullif(btrim(p_linkedin_url), ''),
    bio = nullif(btrim(p_bio), ''),
    office_address = nullif(btrim(p_office_address), ''),
    website = nullif(btrim(p_website), ''),
    x_url = nullif(btrim(p_x_url), ''),
    instagram_url = nullif(btrim(p_instagram_url), ''),
    working_hours = coalesce(
      nullif(btrim(p_working_hours), ''),
      'Mon - Fri: 9:00 AM - 5:00 PM'
    ),
    updated_at = now()
  where id = auth.uid()
    and active = true;

  if not found then
    raise exception 'Active employee profile not found';
  end if;
end;
$$;

revoke all
on function public.update_my_employee_profile(
  text,text,text,text,text,text,text,text,text,text
)
from public, anon;

grant execute
on function public.update_my_employee_profile(
  text,text,text,text,text,text,text,text,text,text
)
to authenticated;

commit;

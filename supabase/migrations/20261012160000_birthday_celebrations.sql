-- Birthday celebrations.
--
-- On a person's birthday (Lagos date):
--   * They see a celebration the first time they open the workspace that day.
--   * Colleagues see a small card and can send a short birthday wish.
--   * They are emailed a birthday card at 06:00 Lagos time, automatically.
--   * Everyone else gets a bell notification (no email, so inboxes stay quiet).
--
-- The birthday email uses the existing notification email pipeline: this adds a
-- 'birthday' notification, and the notifications-email-dispatch function
-- renders it as a designed card. Redeploy that function after running this.
--
-- Only the day and month are used; the year and age are never shown.
--
-- Safe to run twice.

begin;

-- 1. Is a date the person's birthday? Feb 29 is celebrated on Feb 28 in years
-- that are not leap years.
create or replace function public.is_birthday_on(dob date, d date)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select dob is not null and (
    (extract(month from dob) = extract(month from d) and extract(day from dob) = extract(day from d))
    or (
      extract(month from dob) = 2 and extract(day from dob) = 29
      and extract(month from d) = 2 and extract(day from d) = 28
      and extract(day from (make_date(extract(year from d)::int, 3, 1) - 1)) <> 29
    )
  );
$$;

revoke all on function public.is_birthday_on(date, date) from public, anon;
grant execute on function public.is_birthday_on(date, date) to authenticated;

-- 2. Wishes and the log of greetings already sent.
create table if not exists public.birthday_wishes (
  id uuid primary key default gen_random_uuid(),
  to_id uuid not null references public.employee_profiles(id) on delete cascade,
  from_id uuid not null references public.employee_profiles(id) on delete cascade,
  year int not null,
  message text not null check (char_length(message) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (to_id, from_id, year)
);

create table if not exists public.birthday_greetings_sent (
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  year int not null,
  sent_at timestamptz not null default now(),
  primary key (employee_id, year)
);

alter table public.birthday_wishes enable row level security;
alter table public.birthday_greetings_sent enable row level security;

-- No direct access: everything goes through the functions below.
revoke all on public.birthday_wishes from anon, authenticated;
revoke all on public.birthday_greetings_sent from anon, authenticated;

-- 3. Who has a birthday today.
create or replace function public.get_birthdays_today()
returns table(employee_id uuid, full_name text, department text, job_title text, avatar_path text, is_me boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if auth.uid() is null or not exists (
    select 1 from public.employee_profiles where id = auth.uid() and active = true
  ) then
    raise exception 'Active workspace profile required' using errcode = '42501';
  end if;

  return query
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)),
         p.department,
         p.job_title,
         p.avatar_path,
         p.id = auth.uid()
  from public.employee_profiles p
  where p.active = true
    and public.is_birthday_on(p.date_of_birth, today)
  order by (p.id = auth.uid()) desc, 2;
end;
$$;

revoke all on function public.get_birthdays_today() from public, anon;
grant execute on function public.get_birthdays_today() to authenticated;

-- 4. Send a wish. One per colleague per birthday, only on the day itself.
create or replace function public.send_birthday_wish(p_to uuid, p_message text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Africa/Lagos')::date;
  note text := left(btrim(coalesce(p_message, '')), 300);
  sender text;
begin
  if me is null or not exists (select 1 from public.employee_profiles where id = me and active = true) then
    raise exception 'Active workspace profile required' using errcode = '42501';
  end if;
  if p_to = me then
    raise exception 'You cannot send a wish to yourself';
  end if;
  if note = '' then
    raise exception 'Write a short message first';
  end if;
  if not exists (
    select 1 from public.employee_profiles
    where id = p_to and active = true and public.is_birthday_on(date_of_birth, today)
  ) then
    raise exception 'It is not that person''s birthday today';
  end if;

  insert into public.birthday_wishes(to_id, from_id, year, message)
  values (p_to, me, extract(year from today)::int, note)
  on conflict (to_id, from_id, year) do nothing;
  if not found then
    raise exception 'You already sent your wish';
  end if;

  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into sender
  from public.employee_profiles where id = me;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (p_to, 'birthday_wish', sender || ' wished you a happy birthday', note, null, null, 'skipped');
end;
$$;

revoke all on function public.send_birthday_wish(uuid, text) from public, anon;
grant execute on function public.send_birthday_wish(uuid, text) to authenticated;

-- 5. The wishes the person has received on this birthday.
create or replace function public.get_my_birthday_wishes()
returns table(from_name text, message text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)), w.message, w.created_at
  from public.birthday_wishes w
  join public.employee_profiles p on p.id = w.from_id
  where w.to_id = auth.uid()
    and w.year = extract(year from (now() at time zone 'Africa/Lagos'))::int
  order by w.created_at;
$$;

revoke all on function public.get_my_birthday_wishes() from public, anon;
grant execute on function public.get_my_birthday_wishes() to authenticated;

-- 6. The automatic part. Runs every morning and once per person per year, so
-- running it again the same day does nothing. Not callable from the app.
create or replace function public.send_birthday_greetings()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'Africa/Lagos')::date;
  yr int := extract(year from (now() at time zone 'Africa/Lagos'))::int;
  person record;
  sent int := 0;
  first_name text;
begin
  for person in
    select p.id,
           coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) as name
    from public.employee_profiles p
    where p.active = true
      and public.is_birthday_on(p.date_of_birth, today)
      and not exists (
        select 1 from public.birthday_greetings_sent g where g.employee_id = p.id and g.year = yr
      )
  loop
    insert into public.birthday_greetings_sent(employee_id, year) values (person.id, yr)
    on conflict do nothing;

    first_name := split_part(person.name, ' ', 1);

    -- The card, by email (and in the bell).
    insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
    values (person.id, 'birthday', 'Happy Birthday, ' || first_name || '!',
            'Everyone at RideArrivo is celebrating you today.', null, null, 'pending');

    -- A quiet heads-up for everyone else: bell only, no email.
    insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
    select p.id, 'birthday_today', 'Today is ' || person.name || '''s birthday',
           'Open the workspace to send them your wishes.', null, null, 'skipped'
    from public.employee_profiles p
    where p.active = true and p.id <> person.id;

    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke all on function public.send_birthday_greetings() from public, anon, authenticated;

-- Every morning at 06:00 Lagos time (05:00 UTC).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ridearrivo-birthday-greetings';
    perform cron.schedule('ridearrivo-birthday-greetings', '0 5 * * *', 'select public.send_birthday_greetings();');
  else
    raise notice 'pg_cron is not enabled: schedule select public.send_birthday_greetings() daily instead.';
  end if;
exception when others then
  raise notice 'Birthday schedule skipped: %', sqlerrm;
end;
$$;

commit;

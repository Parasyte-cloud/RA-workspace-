-- Ribbon recognition suite.
--   * direct ribbons from chat and ROOM 7 (ribbon_gifts)
--   * who earned what (ribbon_awards), weekly leaderboard, automatic
--     Golden of the Week champion with a photo that stays until the next one
--   * on-time streaks, thank-you replies, monthly golden budgets
--   * team milestone events (project finished, department cleared its overdue list)
--   * monthly leadership digest

-- ---------------------------------------------------------------------------
-- Budget per granted person
-- ---------------------------------------------------------------------------
alter table public.work_ribbon_grants
  add column if not exists golden_monthly_limit integer not null default 3
  check (golden_monthly_limit between 0 and 50);

-- ---------------------------------------------------------------------------
-- Ribbons given straight to a person (chat) or to a name (ROOM 7 buzzer)
-- ---------------------------------------------------------------------------
create table if not exists public.ribbon_gifts (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.employee_profiles(id) on delete cascade,
  honoree_name text check (honoree_name is null or char_length(honoree_name) <= 80),
  given_by uuid not null references public.employee_profiles(id) on delete cascade,
  kind text not null check (kind in ('golden', 'rocket', 'crown', 'star', 'rainbow', 'diamond', 'fire', 'heart')),
  message text not null default '' check (char_length(message) <= 280),
  source text not null check (source in ('chat', 'room7')),
  source_ref text,
  created_at timestamptz not null default now(),
  check (recipient_id is not null or honoree_name is not null)
);
create index if not exists ribbon_gifts_recipient_idx on public.ribbon_gifts(recipient_id, created_at desc);
create index if not exists ribbon_gifts_giver_idx on public.ribbon_gifts(given_by, created_at desc);

create table if not exists public.ribbon_gift_seen (
  gift_id uuid not null references public.ribbon_gifts(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (gift_id, user_id)
);

-- A thank-you for a ribbon (either a task ribbon or a direct gift).
create table if not exists public.ribbon_thanks (
  ribbon_id uuid not null,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ribbon_id, user_id)
);

-- Golden of the Week. One row per week, crowned automatically.
create table if not exists public.ribbon_champions (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  score integer not null,
  golden integer not null,
  total integer not null,
  crowned_at timestamptz not null default now()
);

create table if not exists public.team_milestones (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('project_complete', 'dept_overdue_clear')),
  title text not null,
  project_id uuid,
  department text,
  created_at timestamptz not null default now()
);
create index if not exists team_milestones_created_idx on public.team_milestones(created_at desc);

create table if not exists public.team_milestone_seen (
  milestone_id uuid not null references public.team_milestones(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (milestone_id, user_id)
);

create table if not exists public.ribbon_digests (
  month_start date primary key,
  sent_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['ribbon_gifts','ribbon_gift_seen','ribbon_thanks','ribbon_champions','team_milestones','team_milestone_seen','ribbon_digests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant select on public.ribbon_gifts, public.ribbon_thanks, public.ribbon_champions, public.team_milestones to authenticated;

drop policy if exists "gifts read active" on public.ribbon_gifts;
create policy "gifts read active" on public.ribbon_gifts for select to authenticated using (public.is_active_employee());
drop policy if exists "thanks read active" on public.ribbon_thanks;
create policy "thanks read active" on public.ribbon_thanks for select to authenticated using (public.is_active_employee());
drop policy if exists "champions read active" on public.ribbon_champions;
create policy "champions read active" on public.ribbon_champions for select to authenticated using (public.is_active_employee());
drop policy if exists "milestones read active" on public.team_milestones;
create policy "milestones read active" on public.team_milestones for select to authenticated using (public.is_active_employee());

-- ---------------------------------------------------------------------------
-- Month window in Lagos time, shared by budget and digest
-- ---------------------------------------------------------------------------
create or replace function public.lagos_month_start(p_at timestamptz default now())
returns timestamptz
language sql stable
set search_path = public, pg_temp
as $$
  select date_trunc('month', p_at at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
$$;

create or replace function public.lagos_week_start(p_at timestamptz default now())
returns timestamptz
language sql stable
set search_path = public, pg_temp
as $$
  select date_trunc('week', p_at at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
$$;

-- ---------------------------------------------------------------------------
-- Golden budget
-- ---------------------------------------------------------------------------
create or replace function public.golden_ribbons_used(p_user uuid)
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (
    (select count(*) from public.work_ribbons r
      where r.given_by = p_user and r.kind = 'golden' and r.created_at >= public.lagos_month_start())
    + (select count(*) from public.ribbon_gifts g
      where g.given_by = p_user and g.kind = 'golden' and g.created_at >= public.lagos_month_start())
  )::integer;
$$;

create or replace function public.my_ribbon_budget()
returns table (golden_limit integer, golden_used integer, unlimited boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    case when public.is_workspace_admin() then 0
         else coalesce((select g.golden_monthly_limit from public.work_ribbon_grants g where g.user_id = auth.uid()), 0) end,
    public.golden_ribbons_used(auth.uid()),
    public.is_workspace_admin();
$$;

create or replace function public.assert_golden_budget(p_kind text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer;
begin
  if p_kind <> 'golden' or public.is_workspace_admin() then
    return;
  end if;
  select g.golden_monthly_limit into v_limit from public.work_ribbon_grants g where g.user_id = auth.uid();
  if coalesce(v_limit, 0) <= public.golden_ribbons_used(auth.uid()) then
    raise exception 'You have used your golden ribbons for this month. Try another ribbon.';
  end if;
end;
$$;

-- give_work_ribbon again, with the budget (counted only for a new golden)
create or replace function public.give_work_ribbon(p_item uuid, p_kind text, p_message text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_title text;
  v_status text;
  v_giver text;
  v_label text;
begin
  if not public.can_give_work_ribbon() then
    raise exception 'You have not been given ribbons to hand out';
  end if;
  if not public.can_read_work_item(p_item) then
    raise exception 'Not allowed';
  end if;

  select title, status into v_title, v_status from public.work_items where id = p_item;
  if v_status in ('draft', 'cancelled') then
    raise exception 'Ribbons are for work that is moving or done';
  end if;

  if not exists (select 1 from public.work_ribbons
                 where work_item_id = p_item and given_by = auth.uid() and kind = p_kind) then
    perform public.assert_golden_budget(p_kind);
  end if;

  insert into public.work_ribbons(work_item_id, given_by, kind, message)
  values (p_item, auth.uid(), p_kind, left(btrim(coalesce(p_message, '')), 280))
  on conflict (work_item_id, given_by, kind)
  do update set message = excluded.message, created_at = now()
  returning id into v_id;

  select coalesce(nullif(full_name, ''), email) into v_giver
  from public.employee_profiles where id = auth.uid();

  v_label := public.ribbon_label(p_kind);

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  select distinct r.uid, 'work_ribbon',
         left(coalesce(v_giver, 'Someone') || ' gave you ' || v_label, 120),
         left(v_title || case when btrim(coalesce(p_message, '')) <> '' then ': ' || btrim(p_message) else '' end, 240),
         'work_item', p_item, 'skipped'
  from (
    select a.assignee_id as uid from public.work_item_assignees a where a.work_item_id = p_item
    union
    select w.created_by from public.work_items w where w.id = p_item
  ) r
  where r.uid <> auth.uid();

  return v_id;
end;
$$;

create or replace function public.ribbon_label(p_kind text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'golden' then 'a Golden Ribbon'
    when 'rocket' then 'a Rocket Ribbon'
    when 'crown' then 'a Crown Ribbon'
    when 'rainbow' then 'a Rainbow Ribbon'
    when 'diamond' then 'a Diamond Ribbon'
    when 'fire' then 'a Fire Ribbon'
    when 'heart' then 'a Heart Ribbon'
    else 'a Star Ribbon'
  end;
$$;

-- Ribbon straight to a colleague, for example from a chat message.
create or replace function public.give_direct_ribbon(
  p_recipient uuid, p_kind text, p_message text default '', p_source text default 'chat', p_ref text default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_giver text;
begin
  if not public.can_give_work_ribbon() then
    raise exception 'You have not been given ribbons to hand out';
  end if;
  if p_recipient is null or p_recipient = auth.uid()
     or not exists (select 1 from public.employee_profiles where id = p_recipient and active) then
    raise exception 'Pick a colleague to give the ribbon to';
  end if;
  if p_source not in ('chat', 'room7') then
    raise exception 'Not allowed';
  end if;
  perform public.assert_golden_budget(p_kind);

  insert into public.ribbon_gifts(recipient_id, given_by, kind, message, source, source_ref)
  values (p_recipient, auth.uid(), p_kind, left(btrim(coalesce(p_message, '')), 280), p_source, left(p_ref, 120))
  returning id into v_id;

  select coalesce(nullif(full_name, ''), email) into v_giver from public.employee_profiles where id = auth.uid();

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (
    p_recipient, 'work_ribbon',
    left(coalesce(v_giver, 'Someone') || ' gave you ' || public.ribbon_label(p_kind), 120),
    left(coalesce(nullif(btrim(p_message), ''), 'Open the app to unwrap it.'), 240),
    'ribbon_gift', v_id, 'skipped'
  );
  return v_id;
end;
$$;

-- ROOM 7 golden buzzer: a live moment for a named person. Counts toward the budget.
create or replace function public.give_room_buzzer(p_honoree text, p_message text default '', p_ref text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.can_give_work_ribbon() then
    raise exception 'You have not been given ribbons to hand out';
  end if;
  perform public.assert_golden_budget('golden');
  insert into public.ribbon_gifts(honoree_name, given_by, kind, message, source, source_ref)
  values (left(btrim(coalesce(nullif(p_honoree, ''), 'The team')), 80), auth.uid(), 'golden',
          left(btrim(coalesce(p_message, '')), 280), 'room7', left(p_ref, 120))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unwrapping: both sources
-- ---------------------------------------------------------------------------
drop function if exists public.unseen_work_ribbons();
create or replace function public.unseen_work_ribbons()
returns table (
  id uuid, work_item_id uuid, given_by uuid, kind text, message text,
  created_at timestamptz, task_title text, giver_name text, source text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select * from (
    select r.id, r.work_item_id, r.given_by, r.kind, r.message, r.created_at, w.title as task_title,
           coalesce(nullif(p.full_name, ''), p.email, 'A teammate') as giver_name, 'work'::text as source
    from public.work_ribbons r
    join public.work_items w on w.id = r.work_item_id
    left join public.employee_profiles p on p.id = r.given_by
    where public.is_active_employee()
      and r.given_by <> auth.uid()
      and (
        w.created_by = auth.uid()
        or exists (select 1 from public.work_item_assignees a where a.work_item_id = w.id and a.assignee_id = auth.uid())
      )
      and not exists (select 1 from public.work_ribbon_seen s where s.ribbon_id = r.id and s.user_id = auth.uid())
    union all
    select g.id, null::uuid, g.given_by, g.kind, g.message, g.created_at,
           case g.source when 'chat' then 'A message in chat' else 'ROOM 7' end,
           coalesce(nullif(p.full_name, ''), p.email, 'A teammate'), 'gift'::text
    from public.ribbon_gifts g
    left join public.employee_profiles p on p.id = g.given_by
    where public.is_active_employee()
      and g.recipient_id = auth.uid()
      and not exists (select 1 from public.ribbon_gift_seen s where s.gift_id = g.id and s.user_id = auth.uid())
  ) u
  order by (u.kind = 'golden') desc, u.created_at desc
  limit 20;
$$;

create or replace function public.mark_work_ribbons_seen(p_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.work_ribbon_seen(ribbon_id, user_id)
  select r.id, auth.uid()
  from public.work_ribbons r
  where r.id = any(p_ids) and public.is_active_employee() and public.can_read_work_item(r.work_item_id)
  on conflict do nothing;

  insert into public.ribbon_gift_seen(gift_id, user_id)
  select g.id, auth.uid()
  from public.ribbon_gifts g
  where g.id = any(p_ids) and g.recipient_id = auth.uid() and public.is_active_employee()
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Thank-you reply
-- ---------------------------------------------------------------------------
create or replace function public.thank_ribbon(p_ribbon uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_giver uuid;
  v_kind text;
  v_me text;
  v_ok boolean := false;
  v_item uuid;
begin
  if auth.uid() is null or not public.is_active_employee() then
    raise exception 'Not allowed';
  end if;

  select r.given_by, r.kind, r.work_item_id into v_giver, v_kind, v_item
  from public.work_ribbons r where r.id = p_ribbon;

  if v_giver is not null then
    select exists (select 1 from public.work_item_assignees a where a.work_item_id = v_item and a.assignee_id = auth.uid())
        or exists (select 1 from public.work_items w where w.id = v_item and w.created_by = auth.uid())
      into v_ok;
  else
    select g.given_by, g.kind into v_giver, v_kind
    from public.ribbon_gifts g where g.id = p_ribbon and g.recipient_id = auth.uid();
    v_ok := v_giver is not null;
  end if;

  if not v_ok or v_giver = auth.uid() then
    raise exception 'Not allowed';
  end if;

  insert into public.ribbon_thanks(ribbon_id, user_id) values (p_ribbon, auth.uid()) on conflict do nothing;
  if not found then
    return;
  end if;

  select coalesce(nullif(full_name, ''), email) into v_me from public.employee_profiles where id = auth.uid();
  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (v_giver, 'ribbon_thanks',
          left(coalesce(v_me, 'Someone') || ' says thank you', 120),
          'Thanks for the ' || initcap(v_kind) || ' ribbon. It made their day.',
          case when v_item is null then 'ribbon_gift' else 'work_item' end,
          coalesce(v_item, p_ribbon), 'skipped');
end;
$$;

-- ---------------------------------------------------------------------------
-- Who earned what
-- ---------------------------------------------------------------------------
create or replace function public.ribbon_awards(
  p_user uuid default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 60
)
returns table (
  ribbon_id uuid, source text, recipient_id uuid, kind text, message text,
  given_by uuid, giver_name text, created_at timestamptz, task_title text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select * from (
    select r.id, 'work'::text, a.rid, r.kind, r.message, r.given_by,
           coalesce(nullif(gp.full_name, ''), gp.email, 'A teammate'), r.created_at,
           case when public.can_read_work_item(r.work_item_id) then w.title else null end
    from public.work_ribbons r
    join public.work_items w on w.id = r.work_item_id
    left join public.employee_profiles gp on gp.id = r.given_by
    cross join lateral (
      select x.rid from (
        select ass.assignee_id as rid from public.work_item_assignees ass where ass.work_item_id = r.work_item_id
        union
        select w.created_by where not exists (select 1 from public.work_item_assignees z where z.work_item_id = r.work_item_id)
      ) x where x.rid <> r.given_by
    ) a
    union all
    select g.id, 'gift'::text, g.recipient_id, g.kind, g.message, g.given_by,
           coalesce(nullif(gp.full_name, ''), gp.email, 'A teammate'), g.created_at, null::text
    from public.ribbon_gifts g
    left join public.employee_profiles gp on gp.id = g.given_by
    where g.recipient_id is not null
  ) u
  where public.is_active_employee()
    and (p_user is null or u.rid = p_user)
    and (p_from is null or u.created_at >= p_from)
    and (p_to is null or u.created_at < p_to)
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 500));
$$;

-- Same rows, column names matched to the declared output (SQL functions need
-- the output list to line up, so the real name is applied by this wrapper).
-- (ribbon_awards above already returns recipient_id as its third column.)

create or replace function public.work_streak(p_user uuid)
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $$
  with done as (
    select coalesce(w.completed_at, w.updated_at) as finished, w.due_at
    from public.work_items w
    join public.work_item_assignees a on a.work_item_id = w.id and a.assignee_id = p_user
    where public.is_active_employee()
      and w.status = 'completed' and w.due_at is not null
  ), ranked as (
    select (finished <= due_at) as ontime, row_number() over (order by finished desc) as rn from done
  )
  select coalesce((select min(rn) - 1 from ranked where not ontime), (select count(*) from ranked), 0)::integer;
$$;

create or replace function public.ribbon_leaderboard(p_from timestamptz, p_to timestamptz, p_limit integer default 5)
returns table (
  user_id uuid, full_name text, department text, chat_avatar_path text,
  total integer, golden integer, score integer, streak integer
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.recipient_id, coalesce(nullif(p.full_name, ''), p.email), p.department, cp.avatar_path,
         s.total::integer, s.golden::integer, s.score::integer, public.work_streak(s.recipient_id)
  from (
    select a.recipient_id, count(*) as total, count(*) filter (where a.kind = 'golden') as golden,
           sum(case when a.kind = 'golden' then 5 else 3 end) as score, min(a.created_at) as first_at
    from public.ribbon_awards(null, p_from, p_to, 500) a
    group by a.recipient_id
  ) s
  join public.employee_profiles p on p.id = s.recipient_id and p.active
  left join public.chat_profiles cp on cp.user_id = s.recipient_id
  order by s.score desc, s.golden desc, s.first_at asc
  limit greatest(1, least(coalesce(p_limit, 5), 25));
$$;

-- ---------------------------------------------------------------------------
-- Golden of the Week, crowned automatically
-- ---------------------------------------------------------------------------
create or replace function public.crown_ribbon_champion()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_week timestamptz := public.lagos_week_start() - interval '7 days';
  v_wk date := (public.lagos_week_start() - interval '7 days') at time zone 'Africa/Lagos';
  w record;
  v_name text;
begin
  v_wk := ((public.lagos_week_start() - interval '7 days') at time zone 'Africa/Lagos')::date;
  if exists (select 1 from public.ribbon_champions where week_start = v_wk) then
    return;
  end if;

  -- The leaderboard reads through the caller's permissions, so rank here directly.
  select s.recipient_id, s.score, s.golden, s.total into w
  from (
    select a.recipient_id, count(*) as total, count(*) filter (where a.kind = 'golden') as golden,
           sum(case when a.kind = 'golden' then 5 else 3 end) as score, min(a.created_at) as first_at
    from (
      select a2.rid as recipient_id, r.kind, r.created_at
      from public.work_ribbons r
      cross join lateral (
        select x.rid from (
          select ass.assignee_id as rid from public.work_item_assignees ass where ass.work_item_id = r.work_item_id
          union
          select wi.created_by from public.work_items wi
          where wi.id = r.work_item_id
            and not exists (select 1 from public.work_item_assignees z where z.work_item_id = r.work_item_id)
        ) x where x.rid <> r.given_by
      ) a2
      where r.created_at >= v_week and r.created_at < v_week + interval '7 days'
      union all
      select g.recipient_id, g.kind, g.created_at from public.ribbon_gifts g
      where g.recipient_id is not null and g.created_at >= v_week and g.created_at < v_week + interval '7 days'
    ) a
    join public.employee_profiles p on p.id = a.recipient_id and p.active
    group by a.recipient_id
  ) s
  order by s.score desc, s.golden desc, s.first_at asc
  limit 1;

  if w.recipient_id is null then
    return;
  end if;

  insert into public.ribbon_champions(week_start, user_id, score, golden, total)
  values (v_wk, w.recipient_id, w.score, w.golden, w.total)
  on conflict (week_start) do nothing;

  if found then
    insert into public.notifications(user_id, type, title, body, entity_type, email_status)
    values (w.recipient_id, 'ribbon_champion', 'You are Golden of the Week',
            'Your ribbons from last week made you the top of the Hall of Fame. Your photo gets the golden frame until the next winner.',
            'ribbon_champion', 'pending');
  end if;
end;
$$;

create or replace function public.current_ribbon_champion()
returns table (
  user_id uuid, full_name text, job_title text, department text, headshot_path text, chat_avatar_path text,
  week_start date, score integer, golden integer, total integer, streak integer
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_employee() then
    return;
  end if;
  perform public.crown_ribbon_champion();
  return query
    select c.user_id, coalesce(nullif(p.full_name, ''), p.email), p.job_title, p.department,
           p.avatar_path, cp.avatar_path, c.week_start, c.score, c.golden, c.total, public.work_streak(c.user_id)
    from public.ribbon_champions c
    join public.employee_profiles p on p.id = c.user_id
    left join public.chat_profiles cp on cp.user_id = c.user_id
    order by c.week_start desc
    limit 1;
end;
$$;

-- Everyone on staff may open the champion's headshot, and only the champion's.
drop policy if exists "champion headshot readable by staff" on storage.objects;
create policy "champion headshot readable by staff" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employee-headshots'
    and public.is_active_employee()
    and (storage.foldername(name))[1] = (
      select c.user_id::text from public.ribbon_champions c order by c.week_start desc limit 1
    )
  );

-- ---------------------------------------------------------------------------
-- Team milestones
-- ---------------------------------------------------------------------------
create or replace function public.work_item_milestones()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_done integer;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  if new.project_space_id is not null
     and not exists (select 1 from public.work_items w
                     where w.project_space_id = new.project_space_id and w.status in ('assigned', 'in_progress', 'blocked', 'review', 'draft')) then
    select count(*) into v_done from public.work_items w
    where w.project_space_id = new.project_space_id and w.status = 'completed';
    select name into v_name from public.collaboration_spaces where id = new.project_space_id;
    if v_done >= 3 and v_name is not null
       and not exists (select 1 from public.team_milestones m
                       where m.kind = 'project_complete' and m.project_id = new.project_space_id
                         and m.created_at > now() - interval '7 days') then
      insert into public.team_milestones(kind, title, project_id) values ('project_complete', v_name, new.project_space_id);
    end if;
  end if;

  if new.department is not null and old.due_at is not null and old.due_at < now()
     and not exists (select 1 from public.work_items w
                     where w.department = new.department and w.status in ('assigned', 'in_progress', 'blocked', 'review')
                       and w.due_at is not null and w.due_at < now())
     and not exists (select 1 from public.team_milestones m
                     where m.kind = 'dept_overdue_clear' and m.department = new.department
                       and m.created_at > now() - interval '12 hours') then
    insert into public.team_milestones(kind, title, department) values ('dept_overdue_clear', new.department, new.department);
  end if;

  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.work_item_milestones() from public, anon, authenticated;
drop trigger if exists work_items_milestones on public.work_items;
create trigger work_items_milestones
  after update of status on public.work_items
  for each row execute function public.work_item_milestones();

create or replace function public.unseen_team_milestones()
returns table (id uuid, kind text, title text, created_at timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.id, m.kind, m.title, m.created_at
  from public.team_milestones m
  where public.is_active_employee()
    and m.created_at > now() - interval '3 days'
    and not exists (select 1 from public.team_milestone_seen s where s.milestone_id = m.id and s.user_id = auth.uid())
  order by m.created_at desc
  limit 5;
$$;

create or replace function public.mark_team_milestones_seen(p_ids uuid[])
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.team_milestone_seen(milestone_id, user_id)
  select m.id, auth.uid() from public.team_milestones m
  where m.id = any(p_ids) and public.is_active_employee()
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Grants: admin sets who and how many golden per month
-- ---------------------------------------------------------------------------
drop function if exists public.set_work_ribbon_grant(uuid, boolean);
create or replace function public.set_work_ribbon_grant(p_user uuid, p_allowed boolean, p_limit integer default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_workspace_admin() then
    raise exception 'Only admins can hand out ribbon permission';
  end if;
  if p_allowed then
    insert into public.work_ribbon_grants(user_id, granted_by, golden_monthly_limit)
    values (p_user, auth.uid(), coalesce(p_limit, 3))
    on conflict (user_id) do update
      set golden_monthly_limit = coalesce(p_limit, public.work_ribbon_grants.golden_monthly_limit);
  else
    delete from public.work_ribbon_grants where user_id = p_user;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Monthly leadership digest
-- ---------------------------------------------------------------------------
create or replace function public.send_ribbon_digest(p_month date default null)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_month date;
  v_total integer;
  v_golden integer;
  v_people integer;
  v_body text := '';
  v_champs text;
  lb record;
  n integer := 0;
  v_label text;
begin
  v_month := coalesce(p_month, ((public.lagos_month_start() - interval '1 month') at time zone 'Africa/Lagos')::date);
  v_start := v_month::timestamp at time zone 'Africa/Lagos';
  v_end := (v_month + interval '1 month')::timestamp at time zone 'Africa/Lagos';

  if exists (select 1 from public.ribbon_digests where month_start = v_month) then
    return 0;
  end if;

  select count(*), count(*) filter (where kind = 'golden'), count(distinct rid)
    into v_total, v_golden, v_people
  from (
    select a.rid, r.kind
    from public.work_ribbons r
    cross join lateral (
      select x.rid from (
        select ass.assignee_id as rid from public.work_item_assignees ass where ass.work_item_id = r.work_item_id
        union
        select wi.created_by from public.work_items wi
        where wi.id = r.work_item_id
          and not exists (select 1 from public.work_item_assignees z where z.work_item_id = r.work_item_id)
      ) x where x.rid <> r.given_by
    ) a
    where r.created_at >= v_start and r.created_at < v_end
    union all
    select g.recipient_id, g.kind from public.ribbon_gifts g
    where g.recipient_id is not null and g.created_at >= v_start and g.created_at < v_end
  ) m;

  insert into public.ribbon_digests(month_start) values (v_month);
  if coalesce(v_total, 0) = 0 then
    return 0;
  end if;

  v_label := to_char(v_month, 'FMMonth YYYY');
  v_body := v_total || ' ribbons were given in ' || v_label || ', ' || v_golden || ' of them golden, '
            || 'recognising ' || v_people || ' people.' || E'\n\nTop of the Hall of Fame\n';

  for lb in
    select row_number() over (order by s.score desc, s.golden desc, s.first_at asc) as pos,
           coalesce(nullif(p.full_name, ''), p.email) as name, s.total, s.golden
    from (
      select m.rid, count(*) as total, count(*) filter (where m.kind = 'golden') as golden,
             sum(case when m.kind = 'golden' then 5 else 3 end) as score, min(m.created_at) as first_at
      from (
        select a.rid, r2.kind, r2.created_at
        from public.work_ribbons r2
        cross join lateral (
          select x.rid from (
            select ass.assignee_id as rid from public.work_item_assignees ass where ass.work_item_id = r2.work_item_id
            union
            select wi.created_by from public.work_items wi
            where wi.id = r2.work_item_id
              and not exists (select 1 from public.work_item_assignees z where z.work_item_id = r2.work_item_id)
          ) x where x.rid <> r2.given_by
        ) a
        where r2.created_at >= v_start and r2.created_at < v_end
        union all
        select g.recipient_id, g.kind, g.created_at from public.ribbon_gifts g
        where g.recipient_id is not null and g.created_at >= v_start and g.created_at < v_end
      ) m
      group by m.rid
    ) s
    join public.employee_profiles p on p.id = s.rid
    order by pos
    limit 5
  loop
    v_body := v_body || lb.pos || '. ' || lb.name || ', ' || lb.total || case when lb.total = 1 then ' ribbon (' else ' ribbons (' end || lb.golden || ' golden)' || E'\n';
  end loop;

  select string_agg(to_char(c.week_start, 'DD Mon') || ': ' || coalesce(nullif(p.full_name, ''), p.email), E'\n' order by c.week_start)
    into v_champs
  from public.ribbon_champions c join public.employee_profiles p on p.id = c.user_id
  where c.week_start >= v_month and c.week_start < (v_month + interval '1 month')::date;

  if v_champs is not null then
    v_body := v_body || E'\nGolden of the Week\n' || v_champs;
  end if;

  insert into public.notifications(user_id, type, title, body, entity_type, email_status)
  select p.id, 'ribbon_digest', 'Ribbon digest for ' || v_label, v_body, 'ribbon_digest', 'pending'
  from public.employee_profiles p
  where p.active and p.role in ('admin', 'cto', 'manager');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.lagos_month_start(timestamptz), public.lagos_week_start(timestamptz) from public, anon;
grant execute on function public.lagos_month_start(timestamptz), public.lagos_week_start(timestamptz) to authenticated;
revoke all on function public.golden_ribbons_used(uuid), public.assert_golden_budget(text) from public, anon, authenticated;
revoke all on function public.crown_ribbon_champion() from public, anon, authenticated;
revoke all on function public.send_ribbon_digest(date) from public, anon, authenticated;
revoke all on function public.ribbon_label(text) from public, anon;
revoke all on function public.my_ribbon_budget() from public, anon;
revoke all on function public.give_direct_ribbon(uuid, text, text, text, text) from public, anon;
revoke all on function public.give_room_buzzer(text, text, text) from public, anon;
revoke all on function public.unseen_work_ribbons() from public, anon;
revoke all on function public.mark_work_ribbons_seen(uuid[]) from public, anon;
revoke all on function public.thank_ribbon(uuid) from public, anon;
revoke all on function public.ribbon_awards(uuid, timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.work_streak(uuid) from public, anon;
revoke all on function public.ribbon_leaderboard(timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.current_ribbon_champion() from public, anon;
revoke all on function public.unseen_team_milestones() from public, anon;
revoke all on function public.mark_team_milestones_seen(uuid[]) from public, anon;
revoke all on function public.set_work_ribbon_grant(uuid, boolean, integer) from public, anon;
revoke all on function public.give_work_ribbon(uuid, text, text) from public, anon;

grant execute on function public.my_ribbon_budget() to authenticated;
grant execute on function public.give_direct_ribbon(uuid, text, text, text, text) to authenticated;
grant execute on function public.give_room_buzzer(text, text, text) to authenticated;
grant execute on function public.unseen_work_ribbons() to authenticated;
grant execute on function public.mark_work_ribbons_seen(uuid[]) to authenticated;
grant execute on function public.thank_ribbon(uuid) to authenticated;
grant execute on function public.ribbon_awards(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.work_streak(uuid) to authenticated;
grant execute on function public.ribbon_leaderboard(timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.current_ribbon_champion() to authenticated;
grant execute on function public.unseen_team_milestones() to authenticated;
grant execute on function public.mark_team_milestones_seen(uuid[]) to authenticated;
grant execute on function public.set_work_ribbon_grant(uuid, boolean, integer) to authenticated;
grant execute on function public.give_work_ribbon(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime and schedules
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['ribbon_gifts', 'team_milestones', 'ribbon_thanks'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Monday 00:10 and the 1st at 07:00, Lagos time (UTC+1).
    perform cron.schedule('ridearrivo-ribbon-champion', '10 23 * * 0', $job$select public.crown_ribbon_champion()$job$);
    perform cron.schedule('ridearrivo-ribbon-digest', '0 6 1 * *', $job$select public.send_ribbon_digest()$job$);
  end if;
exception when others then
  raise notice 'Ribbon schedules were not created: %', sqlerrm;
end $$;

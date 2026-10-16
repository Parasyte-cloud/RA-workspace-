-- Work reactions and celebration ribbons.
--
-- Small reactions: anyone who can read a task can react (like chat).
-- Ribbons: the big celebration. Only admins and people an admin has granted
-- may give one. Writes go through functions so the rules live in one place.

create table if not exists public.work_item_reactions (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (work_item_id, user_id, emoji)
);
create index if not exists work_item_reactions_item_idx on public.work_item_reactions(work_item_id);

create table if not exists public.work_ribbons (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  given_by uuid not null references public.employee_profiles(id) on delete cascade,
  kind text not null check (kind in ('golden', 'rocket', 'crown', 'star', 'rainbow', 'diamond', 'fire', 'heart')),
  message text not null default '' check (char_length(message) <= 280),
  created_at timestamptz not null default now(),
  unique (work_item_id, given_by, kind)
);
create index if not exists work_ribbons_item_idx on public.work_ribbons(work_item_id);

create table if not exists public.work_ribbon_grants (
  user_id uuid primary key references public.employee_profiles(id) on delete cascade,
  granted_by uuid not null references public.employee_profiles(id) on delete restrict,
  granted_at timestamptz not null default now()
);

alter table public.work_item_reactions enable row level security;
alter table public.work_ribbons enable row level security;
alter table public.work_ribbon_grants enable row level security;

revoke all on public.work_item_reactions, public.work_ribbons, public.work_ribbon_grants from anon, authenticated;
grant select on public.work_item_reactions, public.work_ribbons, public.work_ribbon_grants to authenticated;
grant all on public.work_item_reactions, public.work_ribbons, public.work_ribbon_grants to service_role;

drop policy if exists "reactions read with task" on public.work_item_reactions;
create policy "reactions read with task" on public.work_item_reactions
  for select to authenticated
  using (public.is_active_employee() and public.can_read_work_item(work_item_id));

drop policy if exists "ribbons read with task" on public.work_ribbons;
create policy "ribbons read with task" on public.work_ribbons
  for select to authenticated
  using (public.is_active_employee() and public.can_read_work_item(work_item_id));

drop policy if exists "grants read own or admin" on public.work_ribbon_grants;
create policy "grants read own or admin" on public.work_ribbon_grants
  for select to authenticated
  using (public.is_active_employee() and (user_id = auth.uid() or public.is_workspace_admin()));

create or replace function public.can_give_work_ribbon()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_active_employee()
    and (
      public.is_workspace_admin()
      or exists (select 1 from public.work_ribbon_grants g where g.user_id = auth.uid())
    );
$$;

-- Toggle a small reaction. Returns true when it was added, false when removed.
create or replace function public.react_to_work_item(p_item uuid, p_emoji text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_deleted integer;
begin
  if auth.uid() is null or not public.is_active_employee() then
    raise exception 'Not allowed';
  end if;
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 16 then
    raise exception 'Pick a single reaction';
  end if;
  if not public.can_read_work_item(p_item) then
    raise exception 'Not allowed';
  end if;

  delete from public.work_item_reactions
  where work_item_id = p_item and user_id = auth.uid() and emoji = v_emoji;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    return false;
  end if;

  -- A person may use at most 12 different reactions on one task.
  if (select count(*) from public.work_item_reactions
      where work_item_id = p_item and user_id = auth.uid()) >= 12 then
    raise exception 'That is plenty of reactions for one task';
  end if;

  insert into public.work_item_reactions(work_item_id, user_id, emoji)
  values (p_item, auth.uid(), v_emoji);
  return true;
end;
$$;

-- Give a celebration ribbon. Notifies the assignees and the task owner.
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

  insert into public.work_ribbons(work_item_id, given_by, kind, message)
  values (p_item, auth.uid(), p_kind, left(btrim(coalesce(p_message, '')), 280))
  on conflict (work_item_id, given_by, kind)
  do update set message = excluded.message, created_at = now()
  returning id into v_id;

  select coalesce(nullif(full_name, ''), email) into v_giver
  from public.employee_profiles where id = auth.uid();

  v_label := case p_kind
    when 'golden' then 'a Golden Ribbon'
    when 'rocket' then 'a Rocket Ribbon'
    when 'crown' then 'a Crown Ribbon'
    when 'rainbow' then 'a Rainbow Ribbon'
    when 'diamond' then 'a Diamond Ribbon'
    when 'fire' then 'a Fire Ribbon'
    when 'heart' then 'a Heart Ribbon'
    else 'a Star Ribbon'
  end;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  select distinct r.uid, 'work_ribbon',
         left(coalesce(v_giver, 'Someone') || ' gave ' || v_label, 120),
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

-- Which ribbons a person has already unwrapped.
create table if not exists public.work_ribbon_seen (
  ribbon_id uuid not null references public.work_ribbons(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (ribbon_id, user_id)
);
alter table public.work_ribbon_seen enable row level security;
revoke all on public.work_ribbon_seen from anon, authenticated;
grant select on public.work_ribbon_seen to authenticated;
grant all on public.work_ribbon_seen to service_role;
drop policy if exists "seen read own" on public.work_ribbon_seen;
create policy "seen read own" on public.work_ribbon_seen
  for select to authenticated using (user_id = auth.uid());

-- Ribbons waiting to be unwrapped: given on my tasks, by someone else, not yet opened.
create or replace function public.unseen_work_ribbons()
returns table (
  id uuid, work_item_id uuid, given_by uuid, kind text, message text,
  created_at timestamptz, task_title text, giver_name text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select r.id, r.work_item_id, r.given_by, r.kind, r.message, r.created_at, w.title,
         coalesce(nullif(p.full_name, ''), p.email, 'A teammate')
  from public.work_ribbons r
  join public.work_items w on w.id = r.work_item_id
  left join public.employee_profiles p on p.id = r.given_by
  where public.is_active_employee()
    and r.given_by <> auth.uid()
    and (
      w.created_by = auth.uid()
      or exists (select 1 from public.work_item_assignees a
                 where a.work_item_id = w.id and a.assignee_id = auth.uid())
    )
    and not exists (select 1 from public.work_ribbon_seen s
                    where s.ribbon_id = r.id and s.user_id = auth.uid())
  order by (r.kind = 'golden') desc, r.created_at desc
  limit 20;
$$;

create or replace function public.mark_work_ribbons_seen(p_ids uuid[])
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.work_ribbon_seen(ribbon_id, user_id)
  select r.id, auth.uid()
  from public.work_ribbons r
  where r.id = any(p_ids) and public.is_active_employee() and public.can_read_work_item(r.work_item_id)
  on conflict do nothing;
$$;

revoke all on function public.unseen_work_ribbons() from public, anon;
revoke all on function public.mark_work_ribbons_seen(uuid[]) from public, anon;
grant execute on function public.unseen_work_ribbons() to authenticated;
grant execute on function public.mark_work_ribbons_seen(uuid[]) to authenticated;

create or replace function public.remove_work_ribbon(p_ribbon uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.work_ribbons
  where id = p_ribbon
    and (given_by = auth.uid() or public.is_workspace_admin());
end;
$$;

-- Admin only: allow or stop someone giving ribbons.
create or replace function public.set_work_ribbon_grant(p_user uuid, p_allowed boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_workspace_admin() then
    raise exception 'Only admins can hand out ribbon permission';
  end if;
  if p_allowed then
    insert into public.work_ribbon_grants(user_id, granted_by)
    values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.work_ribbon_grants where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.can_give_work_ribbon() from public, anon;
revoke all on function public.react_to_work_item(uuid, text) from public, anon;
revoke all on function public.give_work_ribbon(uuid, text, text) from public, anon;
revoke all on function public.remove_work_ribbon(uuid) from public, anon;
revoke all on function public.set_work_ribbon_grant(uuid, boolean) from public, anon;
grant execute on function public.can_give_work_ribbon() to authenticated;
grant execute on function public.react_to_work_item(uuid, text) to authenticated;
grant execute on function public.give_work_ribbon(uuid, text, text) to authenticated;
grant execute on function public.remove_work_ribbon(uuid) to authenticated;
grant execute on function public.set_work_ribbon_grant(uuid, boolean) to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['work_item_reactions', 'work_ribbons'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

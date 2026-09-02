begin;

create table public.workspace_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z2-9]{8}$'),
  title text not null check (char_length(title) between 2 and 120),
  status text not null default 'active' check (status in ('active','ended')),
  created_by uuid not null references public.employee_profiles(id),
  cloudflare_meeting_id text not null unique check (char_length(cloudflare_meeting_id) between 8 and 160),
  ai_notes_enabled boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_rooms_ended_consistency check (
    (status='active' and ended_at is null)
    or (status='ended' and ended_at is not null)
  )
);

create index workspace_rooms_created_by_idx on public.workspace_rooms(created_by,created_at desc);
create index workspace_rooms_status_idx on public.workspace_rooms(status,created_at desc);

create table public.workspace_room_participants (
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('host','member')),
  cloudflare_participant_id text,
  first_joined_at timestamptz,
  last_joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(room_id,user_id)
);

create index workspace_room_participants_user_idx on public.workspace_room_participants(user_id,last_joined_at desc);

create table public.workspace_room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  event_type text not null check (event_type in ('created','joined','ended')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index workspace_room_events_room_idx on public.workspace_room_events(room_id,created_at desc);

create table public.workspace_room_minutes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  session_id text not null check (char_length(session_id) between 8 and 200),
  status text not null default 'pending'
    check (status in ('pending','ready','failed')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer
    check (duration_seconds is null or duration_seconds >= 0),
  end_reason text,
  transcript_received_at timestamptz,
  summary_received_at timestamptz,
  summary_markdown text
    check (summary_markdown is null or char_length(summary_markdown) <= 200000),
  participant_count integer not null default 0
    check (participant_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id,session_id)
);

create index workspace_room_minutes_created_idx
  on public.workspace_room_minutes(created_at desc);

create table public.workspace_room_attendance (
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  session_id text not null check (char_length(session_id) between 8 and 200),
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 180),
  peer_id text,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(room_id,session_id,user_id)
);

create index workspace_room_attendance_session_idx
  on public.workspace_room_attendance(room_id,session_id,joined_at);

create table public.workspace_room_webhook_deliveries (
  delivery_id text primary key check (char_length(delivery_id) between 8 and 200),
  webhook_id text,
  event_type text not null,
  room_id uuid references public.workspace_rooms(id) on delete set null,
  meeting_id text,
  session_id text,
  status text not null default 'processing'
    check (status in ('processing','processed','failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create or replace function public.touch_workspace_room_updated_at()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  new.created_at=old.created_at;
  new.updated_at=now();
  return new;
end;
$$;


create or replace function public.preserve_workspace_room_minute_state()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  new.started_at=coalesce(new.started_at,old.started_at);
  new.ended_at=coalesce(new.ended_at,old.ended_at);
  new.duration_seconds=coalesce(new.duration_seconds,old.duration_seconds);
  new.end_reason=coalesce(new.end_reason,old.end_reason);
  new.transcript_received_at=coalesce(new.transcript_received_at,old.transcript_received_at);
  new.summary_received_at=coalesce(new.summary_received_at,old.summary_received_at);
  new.summary_markdown=coalesce(new.summary_markdown,old.summary_markdown);
  new.participant_count=greatest(coalesce(new.participant_count,0),old.participant_count);

  if old.status='ready' then
    new.status='ready';
  elsif old.status='failed' and new.status='pending' then
    new.status='failed';
  end if;

  return new;
end;
$$;

create or replace function public.preserve_workspace_room_attendance_state()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  new.joined_at=coalesce(new.joined_at,old.joined_at);
  new.left_at=coalesce(new.left_at,old.left_at);
  return new;
end;
$$;

create trigger workspace_rooms_touch_updated_at
before update on public.workspace_rooms
for each row execute function public.touch_workspace_room_updated_at();

create trigger workspace_room_participants_touch_updated_at
before update on public.workspace_room_participants
for each row execute function public.touch_workspace_room_updated_at();

create trigger workspace_room_minutes_touch_updated_at
before update on public.workspace_room_minutes
for each row execute function public.touch_workspace_room_updated_at();

create trigger workspace_room_attendance_touch_updated_at
before update on public.workspace_room_attendance
for each row execute function public.touch_workspace_room_updated_at();


create trigger workspace_room_minutes_preserve_state
before update on public.workspace_room_minutes
for each row execute function public.preserve_workspace_room_minute_state();

create trigger workspace_room_attendance_preserve_state
before update on public.workspace_room_attendance
for each row execute function public.preserve_workspace_room_attendance_state();

revoke all on function public.touch_workspace_room_updated_at() from public,anon,authenticated;
revoke all on function public.preserve_workspace_room_minute_state() from public,anon,authenticated;
revoke all on function public.preserve_workspace_room_attendance_state() from public,anon,authenticated;

create or replace function public.can_access_workspace_room(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    where me.id=auth.uid()
      and me.active=true
      and exists(
        select 1
        from public.workspace_rooms r
        where r.id=target_room
          and (
            r.created_by=auth.uid()
            or exists(
              select 1
              from public.workspace_room_participants rp
              where rp.room_id=r.id and rp.user_id=auth.uid()
            )
          )
      )
  );
$$;

revoke all on function public.can_access_workspace_room(uuid) from public,anon;
grant execute on function public.can_access_workspace_room(uuid) to authenticated;

alter table public.workspace_rooms enable row level security;
alter table public.workspace_room_participants enable row level security;
alter table public.workspace_room_events enable row level security;
alter table public.workspace_room_minutes enable row level security;
alter table public.workspace_room_attendance enable row level security;
alter table public.workspace_room_webhook_deliveries enable row level security;

create policy "workspace rooms participant read"
on public.workspace_rooms for select to authenticated
using (public.can_access_workspace_room(id));

create policy "workspace room participants room read"
on public.workspace_room_participants for select to authenticated
using (public.can_access_workspace_room(room_id));

create policy "workspace room events room read"
on public.workspace_room_events for select to authenticated
using (public.can_access_workspace_room(room_id));

create policy "workspace room minutes admin read"
on public.workspace_room_minutes for select to authenticated
using (public.has_workspace_role(array['admin']));

create policy "workspace room attendance admin read"
on public.workspace_room_attendance for select to authenticated
using (public.has_workspace_role(array['admin']));

revoke all on public.workspace_rooms from public,anon,authenticated;
revoke all on public.workspace_room_participants from public,anon,authenticated;
revoke all on public.workspace_room_events from public,anon,authenticated;
revoke all on public.workspace_room_minutes from public,anon,authenticated;
revoke all on public.workspace_room_attendance from public,anon,authenticated;
revoke all on public.workspace_room_webhook_deliveries from public,anon,authenticated;

grant select on public.workspace_rooms to authenticated;
grant select on public.workspace_room_participants to authenticated;
grant select on public.workspace_room_events to authenticated;
grant select on public.workspace_room_minutes to authenticated;
grant select on public.workspace_room_attendance to authenticated;

grant all on public.workspace_rooms to service_role;
grant all on public.workspace_room_participants to service_role;
grant all on public.workspace_room_events to service_role;
grant all on public.workspace_room_minutes to service_role;
grant all on public.workspace_room_attendance to service_role;
grant all on public.workspace_room_webhook_deliveries to service_role;
grant usage,select on sequence public.workspace_room_events_id_seq to service_role;


create or replace function public.admin_room7_minutes()
returns table(
  id uuid,
  room_id uuid,
  session_id text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  end_reason text,
  transcript_received_at timestamptz,
  summary_received_at timestamptz,
  summary_markdown text,
  participant_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  room_code text,
  room_title text,
  host_id uuid,
  host_name text,
  host_email text,
  ai_notes_enabled boolean,
  attendees jsonb
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if not public.has_workspace_role(array['admin']) then
    raise exception 'Admin access required';
  end if;

  return query
  select
    m.id,
    m.room_id,
    m.session_id,
    m.status,
    m.started_at,
    m.ended_at,
    m.duration_seconds,
    m.end_reason,
    m.transcript_received_at,
    m.summary_received_at,
    m.summary_markdown,
    m.participant_count,
    m.created_at,
    m.updated_at,
    r.room_code,
    r.title,
    r.created_by,
    host.full_name,
    host.email,
    r.ai_notes_enabled,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id',a.user_id,
            'display_name',a.display_name,
            'joined_at',a.joined_at,
            'left_at',a.left_at
          )
          order by a.joined_at nulls last,a.display_name
        )
        from public.workspace_room_attendance a
        where a.room_id=m.room_id
          and a.session_id=m.session_id
      ),
      '[]'::jsonb
    )
  from public.workspace_room_minutes m
  join public.workspace_rooms r on r.id=m.room_id
  join public.employee_profiles host on host.id=r.created_by
  order by m.created_at desc
  limit 100;
end;
$$;

revoke all on function public.admin_room7_minutes()
from public,anon;

grant execute on function public.admin_room7_minutes()
to authenticated;

comment on function public.admin_room7_minutes() is
  'Admin-only least-privilege ROOM 7 minutes feed with meeting metadata and attendance.';

comment on table public.workspace_rooms is 'RideArrivo ROOM 7 meeting metadata. Realtime media tokens are never stored here.';
comment on table public.workspace_room_participants is 'Employee membership for RideArrivo ROOM 7. Realtime participant auth tokens are intentionally not persisted.';
comment on table public.workspace_room_events is 'Minimal ROOM 7 lifecycle audit trail written by the server-side Room session service.';

comment on table public.workspace_room_minutes is
  'Admin-only R7 AI meeting minutes. Full transcripts are intentionally not persisted by this MVP.';

comment on table public.workspace_room_attendance is
  'Actual ROOM 7 session attendance derived from verified RealtimeKit participant webhooks.';

comment on table public.workspace_room_webhook_deliveries is
  'Server-only deduplication and processing state for signed RealtimeKit webhook deliveries.';

commit;

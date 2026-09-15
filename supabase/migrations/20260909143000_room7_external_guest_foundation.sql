begin;

-- ============================================================
-- ROOM 7 EXTERNAL MEETINGS / EVENTS
--
-- The existing workspace_room_* model remains employee-only.
-- External guests are intentionally isolated into separate
-- tables and receive RealtimeKit identities prefixed guest:<uuid>.
-- Media authentication tokens are never persisted.
-- ============================================================

create table public.room7_external_rooms (
  room_id uuid primary key
    references public.workspace_rooms(id)
    on delete cascade,

  slug text unique
    check (
      slug is null
      or (
        char_length(slug) between 3 and 80
        and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      )
    ),

  room_kind text not null default 'standard'
    check (
      room_kind in (
        'standard',
        'executive',
        'investor',
        'webinar',
        'launch',
        'town_hall'
      )
    ),

  access_mode text not null default 'invitation'
    check (
      access_mode in (
        'invitation',
        'passcode',
        'open'
      )
    ),

  event_state text not null default 'draft'
    check (
      event_state in (
        'draft',
        'pre_event',
        'doors_open',
        'live',
        'intermission',
        'ended',
        'replay'
      )
    ),

  default_guest_role text not null default 'attendee'
    check (
      default_guest_role in (
        'attendee',
        'viewer'
      )
    ),

  public_enabled boolean not null default false,

  public_summary text
    check (
      public_summary is null
      or char_length(public_summary) <= 2000
    ),

  timezone text not null default 'Africa/Lagos'
    check (char_length(timezone) between 1 and 80),

  scheduled_start timestamptz,
  scheduled_end timestamptz,

  passcode_hash text
    check (
      passcode_hash is null
      or passcode_hash ~ '^[0-9a-f]{64}$'
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint room7_external_rooms_schedule_check
    check (
      scheduled_end is null
      or scheduled_start is null
      or scheduled_end > scheduled_start
    ),

  constraint room7_external_rooms_passcode_check
    check (
      access_mode <> 'passcode'
      or passcode_hash is not null
    )
);

create index room7_external_rooms_state_idx
  on public.room7_external_rooms(event_state,scheduled_start);

create index room7_external_rooms_public_idx
  on public.room7_external_rooms(public_enabled,scheduled_start)
  where public_enabled=true;


-- ============================================================
-- INVITATIONS
--
-- Only SHA-256 hashes of invitation secrets are stored.
-- Raw invitation secrets live only in generated guest URLs.
-- ============================================================

create table public.room7_guest_invitations (
  id uuid primary key default gen_random_uuid(),

  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  email text
    check (
      email is null
      or char_length(email) between 3 and 320
    ),

  display_name text
    check (
      display_name is null
      or char_length(display_name) between 1 and 180
    ),

  role text not null default 'attendee'
    check (
      role in (
        'attendee',
        'viewer',
        'presenter'
      )
    ),

  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),

  status text not null default 'active'
    check (
      status in (
        'active',
        'revoked'
      )
    ),

  expires_at timestamptz,

  invited_by uuid not null
    references public.employee_profiles(id),

  first_used_at timestamptz,
  last_used_at timestamptz,

  use_count integer not null default 0
    check (use_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(room_id,id)
);

create index room7_guest_invitations_room_idx
  on public.room7_guest_invitations(room_id,created_at desc);

create index room7_guest_invitations_email_idx
  on public.room7_guest_invitations(room_id,lower(email))
  where email is not null;

create index room7_guest_invitations_active_idx
  on public.room7_guest_invitations(room_id,expires_at)
  where status='active';


-- ============================================================
-- EXTERNAL PARTICIPANTS
--
-- id is our permanent guest identity for this ROOM 7 room.
-- RealtimeKit customParticipantId becomes:
--
--   guest:<id>
--
-- RealtimeKit auth tokens are deliberately NOT stored.
-- ============================================================

create table public.room7_guest_participants (
  id uuid primary key default gen_random_uuid(),

  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  invitation_id uuid,

  display_name text not null
    check (char_length(display_name) between 1 and 180),

  email text
    check (
      email is null
      or char_length(email) between 3 and 320
    ),

  role text not null default 'attendee'
    check (
      role in (
        'attendee',
        'viewer',
        'presenter'
      )
    ),

  source text not null default 'invitation'
    check (
      source in (
        'invitation',
        'open',
        'passcode'
      )
    ),

  cloudflare_participant_id text
    check (
      cloudflare_participant_id is null
      or char_length(cloudflare_participant_id) between 8 and 200
    ),

  first_joined_at timestamptz,
  last_joined_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(room_id,id),

  constraint room7_guest_participants_invitation_fk
    foreign key(room_id,invitation_id)
    references public.room7_guest_invitations(room_id,id)
    on delete set null (invitation_id)
);

create index room7_guest_participants_room_idx
  on public.room7_guest_participants(room_id,last_joined_at desc);

create index room7_guest_participants_invitation_idx
  on public.room7_guest_participants(invitation_id)
  where invitation_id is not null;

create unique index room7_guest_participants_invitation_unique
  on public.room7_guest_participants(room_id,invitation_id)
  where invitation_id is not null;


-- ============================================================
-- EXTERNAL ATTENDANCE
--
-- Kept separate from workspace_room_attendance so the existing
-- employee FK/RLS contract is never weakened.
-- ============================================================

create table public.room7_guest_attendance (
  room_id uuid not null
    references public.workspace_rooms(id)
    on delete cascade,

  session_id text not null
    check (char_length(session_id) between 8 and 200),

  guest_id uuid not null,

  display_name text not null
    check (char_length(display_name) between 1 and 180),

  peer_id text,

  joined_at timestamptz,
  left_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key(room_id,session_id,guest_id),

  constraint room7_guest_attendance_guest_fk
    foreign key(room_id,guest_id)
    references public.room7_guest_participants(room_id,id)
    on delete cascade
);

create index room7_guest_attendance_session_idx
  on public.room7_guest_attendance(
    room_id,
    session_id,
    joined_at
  );


-- ============================================================
-- UPDATE / PRESERVATION TRIGGERS
-- ============================================================

create trigger room7_external_rooms_touch_updated_at
before update on public.room7_external_rooms
for each row execute function public.touch_workspace_room_updated_at();

create trigger room7_guest_invitations_touch_updated_at
before update on public.room7_guest_invitations
for each row execute function public.touch_workspace_room_updated_at();

create trigger room7_guest_participants_touch_updated_at
before update on public.room7_guest_participants
for each row execute function public.touch_workspace_room_updated_at();

create trigger room7_guest_attendance_touch_updated_at
before update on public.room7_guest_attendance
for each row execute function public.touch_workspace_room_updated_at();

create trigger room7_guest_attendance_preserve_state
before update on public.room7_guest_attendance
for each row execute function public.preserve_workspace_room_attendance_state();


-- ============================================================
-- RLS / PRIVILEGES
--
-- No guest table is directly readable or writable by anon
-- clients. External access goes through server-side functions.
-- ============================================================

alter table public.room7_external_rooms enable row level security;
alter table public.room7_guest_invitations enable row level security;
alter table public.room7_guest_participants enable row level security;
alter table public.room7_guest_attendance enable row level security;

revoke all on public.room7_external_rooms
from public,anon,authenticated;

revoke all on public.room7_guest_invitations
from public,anon,authenticated;

revoke all on public.room7_guest_participants
from public,anon,authenticated;

revoke all on public.room7_guest_attendance
from public,anon,authenticated;

grant all on public.room7_external_rooms
to service_role;

grant all on public.room7_guest_invitations
to service_role;

grant all on public.room7_guest_participants
to service_role;

grant all on public.room7_guest_attendance
to service_role;


-- ============================================================
-- ADMIN MINUTES
--
-- Preserve the existing admin-only minutes contract while
-- including verified external ROOM 7 attendees.
-- ============================================================

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
          attendee.payload
          order by attendee.joined_at nulls last,
                   attendee.display_name
        )
        from (
          select
            jsonb_build_object(
              'participant_type','employee',
              'user_id',a.user_id,
              'guest_id',null,
              'display_name',a.display_name,
              'joined_at',a.joined_at,
              'left_at',a.left_at
            ) as payload,
            a.joined_at,
            a.display_name
          from public.workspace_room_attendance a
          where a.room_id=m.room_id
            and a.session_id=m.session_id

          union all

          select
            jsonb_build_object(
              'participant_type','guest',
              'user_id',g.guest_id,
              'guest_id',g.guest_id,
              'display_name',g.display_name,
              'joined_at',g.joined_at,
              'left_at',g.left_at
            ) as payload,
            g.joined_at,
            g.display_name
          from public.room7_guest_attendance g
          where g.room_id=m.room_id
            and g.session_id=m.session_id
        ) attendee
      ),
      '[]'::jsonb
    )
  from public.workspace_room_minutes m
  join public.workspace_rooms r
    on r.id=m.room_id
  join public.employee_profiles host
    on host.id=r.created_by
  order by m.created_at desc
  limit 100;
end;
$$;

revoke all on function public.admin_room7_minutes()
from public,anon;

grant execute on function public.admin_room7_minutes()
to authenticated;

comment on function public.admin_room7_minutes() is
  'Admin-only ROOM 7 minutes feed including employee and verified external guest attendance.';


comment on table public.room7_external_rooms is
  'External-facing ROOM 7 meeting/event configuration. Existing workspace room records remain authoritative for the underlying meeting.';

comment on table public.room7_guest_invitations is
  'Server-only ROOM 7 external invitations. Only hashes of guest invitation secrets are persisted.';

comment on table public.room7_guest_participants is
  'External ROOM 7 participant identities. RealtimeKit participant authentication tokens are intentionally never persisted.';

comment on table public.room7_guest_attendance is
  'External ROOM 7 attendance derived from verified RealtimeKit participant webhooks.';

commit;

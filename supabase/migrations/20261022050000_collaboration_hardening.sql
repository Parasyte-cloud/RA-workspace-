begin;

-- ============================================================
-- RA Collaboration hardening
-- - first-class governed file records
-- - quarantine/promote workflow
-- - canonical attachment message RPC
-- - shared resource links/activity audit
-- - Room7 calendar binding and RPC writes
-- ============================================================

-- ---------- Generic collaboration links / activity ----------
create table if not exists public.collaboration_resource_links (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.collaboration_spaces(id) on delete cascade,
  resource_type text not null check (resource_type in (
    'chat_conversation','room7_meeting','workspace_note','knowledge_article','task','calendar_event'
  )),
  resource_id uuid not null,
  linked_by uuid not null references public.employee_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(space_id, resource_type, resource_id)
);

create index if not exists collaboration_resource_links_resource_idx
  on public.collaboration_resource_links(resource_type, resource_id);

create table if not exists public.collaboration_activity_events (
  id bigint generated always as identity primary key,
  space_id uuid references public.collaboration_spaces(id) on delete cascade,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 80),
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists collaboration_activity_space_idx
  on public.collaboration_activity_events(space_id, created_at desc);

-- ---------- Governed files ----------
create table if not exists public.collaboration_files (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.collaboration_spaces(id) on delete cascade,
  conversation_id uuid references public.social_conversations(id) on delete cascade,
  room_id uuid references public.workspace_rooms(id) on delete cascade,
  owner_id uuid not null references public.employee_profiles(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 255),
  classification text not null default 'internal'
    check (classification in ('internal','confidential','restricted')),
  preview_policy text not null default 'short_lived'
    check (preview_policy in ('short_lived','watermarked','blocked')),
  download_policy text not null default 'allowed'
    check (download_policy in ('allowed','approval','blocked')),
  legal_hold boolean not null default false,
  retention_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collaboration_files_one_scope check (
    num_nonnulls(space_id, conversation_id, room_id) = 1
  )
);

create table if not exists public.collaboration_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.collaboration_files(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  original_name text not null check (char_length(original_name) between 1 and 255),
  declared_mime text,
  verified_mime text,
  bytes bigint not null check (bytes between 1 and 26214400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  quarantine_path text not null unique,
  storage_bucket text,
  storage_path text unique,
  scan_status text not null default 'pending'
    check (scan_status in ('pending','clean','infected','rejected','error')),
  scan_provider text,
  scan_details jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.employee_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  unique(file_id, version_no),
  constraint collaboration_file_clean_requires_storage check (
    scan_status <> 'clean' or
    (storage_bucket is not null and storage_path is not null and sha256 is not null and verified_mime is not null)
  )
);

alter table public.collaboration_files
  add column if not exists current_version_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='collaboration_files_current_version_fk'
      and conrelid='public.collaboration_files'::regclass
  ) then
    alter table public.collaboration_files
      add constraint collaboration_files_current_version_fk
      foreign key(current_version_id)
      references public.collaboration_file_versions(id)
      on delete set null;
  end if;
end $$;

create index if not exists collaboration_files_space_idx
  on public.collaboration_files(space_id, updated_at desc) where deleted_at is null;
create index if not exists collaboration_files_conversation_idx
  on public.collaboration_files(conversation_id, updated_at desc) where deleted_at is null;
create index if not exists collaboration_files_room_idx
  on public.collaboration_files(room_id, updated_at desc) where deleted_at is null;
create index if not exists collaboration_file_versions_file_idx
  on public.collaboration_file_versions(file_id, version_no desc);

create table if not exists public.collaboration_file_links (
  file_id uuid not null references public.collaboration_files(id) on delete cascade,
  resource_type text not null check (resource_type in (
    'message','task','meeting','decision','knowledge','note'
  )),
  resource_id uuid not null,
  created_by uuid not null references public.employee_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(file_id, resource_type, resource_id)
);

create table if not exists public.collaboration_file_access_events (
  id bigint generated always as identity primary key,
  file_id uuid not null references public.collaboration_files(id) on delete cascade,
  version_id uuid references public.collaboration_file_versions(id) on delete set null,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  action text not null check (action in (
    'upload_started','upload_verified','upload_rejected','previewed','downloaded','linked','unlinked','deleted'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists collaboration_file_access_file_idx
  on public.collaboration_file_access_events(file_id, created_at desc);

-- Link new governed attachment messages without breaking historical messages.
alter table public.social_messages
  add column if not exists collaboration_file_id uuid
  references public.collaboration_files(id) on delete set null;

create index if not exists social_messages_collaboration_file_idx
  on public.social_messages(collaboration_file_id)
  where collaboration_file_id is not null;

-- ---------- Access helpers ----------
create or replace function public.can_access_collaboration_file(p_file uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.collaboration_files f
    where f.id=p_file
      and f.deleted_at is null
      and (
        (f.space_id is not null and public.can_access_collaboration_space(f.space_id))
        or (f.conversation_id is not null and public.can_access_social_conversation(f.conversation_id))
        or (f.room_id is not null and public.can_use_room_chat(f.room_id))
      )
  );
$$;

revoke all on function public.can_access_collaboration_file(uuid) from public, anon;
grant execute on function public.can_access_collaboration_file(uuid) to authenticated, service_role;

create or replace function public.can_write_collaboration_file_scope(p_scope_kind text, p_scope_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_scope_kind
    when 'space' then public.can_access_collaboration_space(p_scope_id)
    when 'conversation' then public.can_write_to_conversation(p_scope_id)
    when 'room7' then public.can_use_room_chat(p_scope_id)
    else false
  end;
$$;

revoke all on function public.can_write_collaboration_file_scope(text,uuid) from public, anon;
grant execute on function public.can_write_collaboration_file_scope(text,uuid) to authenticated, service_role;

-- Creates immutable metadata before bytes are accepted. The browser never writes
-- directly to the final bucket.
create or replace function public.begin_collaboration_file_upload(
  p_scope_kind text,
  p_scope_id uuid,
  p_name text,
  p_declared_mime text,
  p_bytes bigint,
  p_classification text default 'internal'
)
returns table(file_id uuid, version_id uuid, quarantine_path text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_file uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_name text := left(btrim(coalesce(p_name,'')),255);
  v_class text := lower(btrim(coalesce(p_classification,'internal')));
  v_path text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.is_active_employee() then raise exception 'Active employee required' using errcode='42501'; end if;
  if not public.can_write_collaboration_file_scope(p_scope_kind,p_scope_id) then
    raise exception 'Collaboration write access required' using errcode='42501';
  end if;
  if char_length(v_name)<1 then raise exception 'File name is required'; end if;
  if p_bytes is null or p_bytes<1 or p_bytes>26214400 then raise exception 'File size is not allowed'; end if;
  if v_class not in ('internal','confidential','restricted') then raise exception 'Invalid classification'; end if;

  v_path := v_actor::text || '/' || v_version::text || '/payload';

  insert into public.collaboration_files(
    id,space_id,conversation_id,room_id,owner_id,display_name,classification,
    preview_policy,download_policy
  ) values (
    v_file,
    case when p_scope_kind='space' then p_scope_id end,
    case when p_scope_kind='conversation' then p_scope_id end,
    case when p_scope_kind='room7' then p_scope_id end,
    v_actor,v_name,v_class,
    case when v_class='internal' then 'short_lived' else 'watermarked' end,
    case when v_class='internal' then 'allowed' else 'approval' end
  );

  insert into public.collaboration_file_versions(
    id,file_id,version_no,original_name,declared_mime,bytes,quarantine_path,created_by
  ) values(v_version,v_file,1,v_name,nullif(lower(btrim(coalesce(p_declared_mime,''))),''),p_bytes,v_path,v_actor);

  insert into public.collaboration_file_access_events(file_id,version_id,actor_id,action)
  values(v_file,v_version,v_actor,'upload_started');

  return query select v_file,v_version,v_path;
end;
$$;

revoke all on function public.begin_collaboration_file_upload(text,uuid,text,text,bigint,text) from public, anon;
grant execute on function public.begin_collaboration_file_upload(text,uuid,text,text,bigint,text) to authenticated;

-- ---------- RLS / grants ----------
alter table public.collaboration_resource_links enable row level security;
alter table public.collaboration_activity_events enable row level security;
alter table public.collaboration_files enable row level security;
alter table public.collaboration_file_versions enable row level security;
alter table public.collaboration_file_links enable row level security;
alter table public.collaboration_file_access_events enable row level security;

create policy collaboration_resource_links_read on public.collaboration_resource_links
  for select to authenticated using(public.can_access_collaboration_space(space_id));
create policy collaboration_activity_read on public.collaboration_activity_events
  for select to authenticated using(space_id is not null and public.can_access_collaboration_space(space_id));
create policy collaboration_files_read on public.collaboration_files
  for select to authenticated using(public.can_access_collaboration_file(id));
create policy collaboration_file_versions_read on public.collaboration_file_versions
  for select to authenticated using(public.can_access_collaboration_file(file_id));
create policy collaboration_file_links_read on public.collaboration_file_links
  for select to authenticated using(public.can_access_collaboration_file(file_id));
create policy collaboration_file_access_read on public.collaboration_file_access_events
  for select to authenticated using(public.can_access_collaboration_file(file_id));

revoke all on public.collaboration_resource_links, public.collaboration_activity_events,
  public.collaboration_files, public.collaboration_file_versions, public.collaboration_file_links,
  public.collaboration_file_access_events from public, anon, authenticated;
grant select on public.collaboration_resource_links, public.collaboration_activity_events,
  public.collaboration_files, public.collaboration_file_versions, public.collaboration_file_links,
  public.collaboration_file_access_events to authenticated;
grant all on public.collaboration_resource_links, public.collaboration_activity_events,
  public.collaboration_files, public.collaboration_file_versions, public.collaboration_file_links,
  public.collaboration_file_access_events to service_role;

-- ---------- Storage ----------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('collaboration-quarantine','collaboration-quarantine',false,26214400,null)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('collaboration-files','collaboration-files',false,26214400,array[
  'image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv','application/zip',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','audio/x-wav'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Browser writes to legacy chat final storage are disabled. Existing reads and
-- orphan/admin cleanup continue to work; the Edge function promotes verified
-- bytes using service_role.
drop policy if exists "chat attachments upload" on storage.objects;

-- Final collaboration-file reads require the caller to have file access. The
-- final path begins with the file UUID.
drop policy if exists "collaboration files read" on storage.objects;
create policy "collaboration files read" on storage.objects
for select to authenticated
using (
  bucket_id='collaboration-files'
  and split_part(name,'/',1) ~ '^[0-9a-f-]{36}$'
  and public.can_access_collaboration_file(split_part(name,'/',1)::uuid)
);

-- Automatically bind any newly-created verified attachment message to its
-- governed file record. This also protects forwarding paths that insert from
-- SECURITY DEFINER functions after the Edge function has created a verified
-- destination file record.
create or replace function public.bind_social_message_collaboration_file()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.attachment_path is not null and new.collaboration_file_id is null then
    select f.id into new.collaboration_file_id
    from public.collaboration_file_versions v
    join public.collaboration_files f on f.id=v.file_id
    where v.storage_bucket='chat-attachments'
      and v.storage_path=new.attachment_path
      and v.scan_status='clean'
      and f.conversation_id=new.conversation_id
      and f.deleted_at is null
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bind_social_message_collaboration_file on public.social_messages;
create trigger bind_social_message_collaboration_file
before insert on public.social_messages
for each row execute function public.bind_social_message_collaboration_file();

-- ---------- Canonical governed chat attachment send ----------
create or replace function public.send_chat_attachment_message(
  p_conversation_id uuid,
  p_file_id uuid,
  p_body text,
  p_reply_to_id uuid,
  p_client_message_id uuid,
  p_duration_ms integer default null
)
returns public.social_messages
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_body text := btrim(coalesce(p_body,''));
  v_file public.collaboration_files%rowtype;
  v_version public.collaboration_file_versions%rowtype;
  v_message public.social_messages%rowtype;
  v_reply public.social_messages%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_client_message_id is null then raise exception 'Client message identifier is required'; end if;
  if not public.can_write_to_conversation(p_conversation_id) then
    raise exception 'Conversation write access required' using errcode='42501';
  end if;
  if char_length(v_body)>10000 then raise exception 'That message is too long'; end if;

  select * into v_file from public.collaboration_files
  where id=p_file_id and conversation_id=p_conversation_id and owner_id=v_actor and deleted_at is null;
  if not found or v_file.current_version_id is null then raise exception 'Verified file not found' using errcode='42501'; end if;

  select * into v_version from public.collaboration_file_versions
  where id=v_file.current_version_id and file_id=v_file.id and scan_status='clean';
  if not found or v_version.storage_bucket<>'chat-attachments' or v_version.storage_path is null then
    raise exception 'File has not passed security verification';
  end if;

  select * into v_message from public.social_messages m
  where m.conversation_id=p_conversation_id and m.sender_id=v_actor and m.client_message_id=p_client_message_id limit 1;
  if found then return v_message; end if;

  if p_reply_to_id is not null then
    select * into v_reply from public.social_messages m
    where m.id=p_reply_to_id and m.conversation_id=p_conversation_id;
    if not found or not public.can_read_message(v_reply.conversation_id,v_reply.created_at) then
      raise exception 'Reply message not found or not accessible' using errcode='42501';
    end if;
  end if;

  insert into public.social_messages(
    conversation_id,sender_id,body,reply_to_id,client_message_id,
    attachment_path,attachment_name,attachment_mime,attachment_size,attachment_duration_ms,collaboration_file_id
  ) values(
    p_conversation_id,v_actor,v_body,p_reply_to_id,p_client_message_id,
    v_version.storage_path,v_file.display_name,v_version.verified_mime,v_version.bytes,
    case when p_duration_ms is null then null else greatest(0,least(p_duration_ms,3600000)) end,v_file.id
  ) returning * into v_message;

  insert into public.collaboration_file_links(file_id,resource_type,resource_id,created_by)
  values(v_file.id,'message',v_message.id,v_actor)
  on conflict do nothing;

  insert into public.collaboration_file_access_events(file_id,version_id,actor_id,action,metadata)
  values(v_file.id,v_version.id,v_actor,'linked',jsonb_build_object('message_id',v_message.id));

  return v_message;
exception when unique_violation then
  select * into v_message from public.social_messages m
  where m.conversation_id=p_conversation_id and m.sender_id=v_actor and m.client_message_id=p_client_message_id limit 1;
  if found then return v_message; end if;
  raise;
end;
$$;

revoke all on function public.send_chat_attachment_message(uuid,uuid,text,uuid,uuid,integer) from public, anon;
grant execute on function public.send_chat_attachment_message(uuid,uuid,text,uuid,uuid,integer) to authenticated;

-- Direct authenticated attachment inserts are no longer allowed. Plain direct
-- inserts remain compatible for legacy non-attachment callers, while the normal
-- UI uses send_chat_message(). SECURITY DEFINER functions such as forwarding
-- continue to work through their own authorization checks.
drop policy if exists "social messages member send" on public.social_messages;
create policy "social messages member send"
on public.social_messages for insert to authenticated
with check (
  sender_id=auth.uid()
  and deleted_at is null
  and public.can_write_to_conversation(conversation_id)
  and attachment_path is null
  and collaboration_file_id is null
);

-- ---------- Room7 calendar hardening ----------
-- Bind future calendar writes to an actual workspace room. NOT VALID avoids
-- blocking deployment if an old malformed row exists, while still enforcing
-- the constraint for new/changed rows.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='room7_calendar_events_meeting_fk'
      and conrelid='public.room7_calendar_events'::regclass
  ) then
    alter table public.room7_calendar_events
      add constraint room7_calendar_events_meeting_fk
      foreign key(meeting_id) references public.workspace_rooms(id) on delete cascade not valid;
  end if;
end $$;

create or replace function public.save_room7_calendar_event(
  p_event_code text,
  p_meeting_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_join_url text,
  p_organizer_name text,
  p_organizer_email text,
  p_reminder_minutes integer[]
)
returns public.room7_calendar_events
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  me uuid:=auth.uid();
  r public.workspace_rooms%rowtype;
  saved public.room7_calendar_events%rowtype;
  code text:=upper(btrim(coalesce(p_event_code,'')));
  canonical text;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into r from public.workspace_rooms where id=p_meeting_id;
  if not found then raise exception 'Meeting not found'; end if;
  if r.created_by<>me and not public.has_workspace_role(array['manager','admin']) then
    raise exception 'Meeting administration access required' using errcode='42501';
  end if;
  if code<>r.room_code then raise exception 'Event code must match the Room7 meeting'; end if;
  if p_ends_at<=p_starts_at then raise exception 'Meeting end must be after start'; end if;
  canonical:='https://room7.ridearrivo.com/r/'||r.room_code;
  if p_join_url<>canonical then raise exception 'Join URL must be the canonical Room7 URL'; end if;

  insert into public.room7_calendar_events(
    event_code,meeting_id,title,description,starts_at,ends_at,timezone,join_url,
    organizer_name,organizer_email,reminder_minutes,status,created_by
  ) values(
    code,p_meeting_id,left(btrim(p_title),200),nullif(btrim(coalesce(p_description,'')),''),
    p_starts_at,p_ends_at,coalesce(nullif(btrim(p_timezone),''),'Africa/Lagos'),canonical,
    nullif(btrim(coalesce(p_organizer_name,'')),''),nullif(btrim(coalesce(p_organizer_email,'')),''),
    coalesce(p_reminder_minutes,array[60,15]),'confirmed',me
  ) on conflict(event_code) do update set
    meeting_id=excluded.meeting_id,title=excluded.title,description=excluded.description,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,
    join_url=excluded.join_url,organizer_name=excluded.organizer_name,
    organizer_email=excluded.organizer_email,reminder_minutes=excluded.reminder_minutes,status='confirmed'
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.cancel_room7_calendar_event(p_event_code text)
returns public.room7_calendar_events
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  me uuid:=auth.uid();
  e public.room7_calendar_events%rowtype;
  r public.workspace_rooms%rowtype;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into e from public.room7_calendar_events where event_code=upper(btrim(p_event_code)) for update;
  if not found then return null; end if;
  select * into r from public.workspace_rooms where id=e.meeting_id;
  if not found or (r.created_by<>me and not public.has_workspace_role(array['manager','admin'])) then
    raise exception 'Meeting administration access required' using errcode='42501';
  end if;
  update public.room7_calendar_events set status='cancelled' where id=e.id returning * into e;
  return e;
end;
$$;

revoke all on function public.save_room7_calendar_event(text,uuid,text,text,timestamptz,timestamptz,text,text,text,text,integer[]) from public,anon;
revoke all on function public.cancel_room7_calendar_event(text) from public,anon;
grant execute on function public.save_room7_calendar_event(text,uuid,text,text,timestamptz,timestamptz,text,text,text,text,integer[]) to authenticated;
grant execute on function public.cancel_room7_calendar_event(text) to authenticated;

-- Remove browser table writes: calendar changes now go through audited/validated RPCs.
revoke insert,update on public.room7_calendar_events from authenticated;
drop policy if exists room7_calendar_events_create on public.room7_calendar_events;
drop policy if exists room7_calendar_events_update on public.room7_calendar_events;

-- ---------- Append-only audit + resource linking ----------
create or replace function public.collaboration_append_only()
returns trigger
language plpgsql
set search_path=pg_catalog,public,pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists collaboration_file_access_append_only on public.collaboration_file_access_events;
create trigger collaboration_file_access_append_only
  before update or delete on public.collaboration_file_access_events
  for each row execute function public.collaboration_append_only();

drop trigger if exists collaboration_activity_append_only on public.collaboration_activity_events;
create trigger collaboration_activity_append_only
  before update or delete on public.collaboration_activity_events
  for each row execute function public.collaboration_append_only();

create or replace function public.link_collaboration_resource(
  p_space_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  me uuid:=auth.uid();
  result uuid;
begin
  if me is null or not public.can_access_collaboration_space(p_space_id) then
    raise exception 'Collaboration space access required' using errcode='42501';
  end if;
  if p_resource_type not in ('chat_conversation','room7_meeting','workspace_note','calendar_event') then
    raise exception 'Unsupported collaboration resource';
  end if;

  if p_resource_type='chat_conversation' and not public.can_access_social_conversation(p_resource_id) then
    raise exception 'Conversation access required' using errcode='42501';
  elsif p_resource_type='room7_meeting' and not public.can_use_room_chat(p_resource_id) then
    raise exception 'Room7 access required' using errcode='42501';
  elsif p_resource_type='workspace_note' and not public.note_can_read(p_resource_id) then
    raise exception 'Note access required' using errcode='42501';
  elsif p_resource_type='calendar_event' and not exists(
    select 1 from public.room7_calendar_events e where e.id=p_resource_id
      and (e.created_by=me or public.has_workspace_role(array['manager','admin']))
  ) then
    raise exception 'Calendar event access required' using errcode='42501';
  end if;

  insert into public.collaboration_resource_links(space_id,resource_type,resource_id,linked_by)
  values(p_space_id,p_resource_type,p_resource_id,me)
  on conflict(space_id,resource_type,resource_id) do update set linked_by=excluded.linked_by
  returning id into result;

  insert into public.collaboration_activity_events(space_id,actor_id,event_type,resource_type,resource_id)
  values(p_space_id,me,'resource.linked',p_resource_type,p_resource_id);

  return result;
end;
$$;

revoke all on function public.link_collaboration_resource(uuid,text,uuid) from public,anon;
grant execute on function public.link_collaboration_resource(uuid,text,uuid) to authenticated;

-- Calendar audit is deliberately separate because a Room7 meeting does not
-- have to be linked to a collaboration space.
create table if not exists public.room7_calendar_audit (
  id bigint generated always as identity primary key,
  event_id uuid references public.room7_calendar_events(id) on delete set null,
  event_code text not null,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  action text not null check(action in ('created','updated','cancelled')),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.room7_calendar_audit enable row level security;
create policy room7_calendar_audit_read on public.room7_calendar_audit
  for select to authenticated using(
    exists(select 1 from public.room7_calendar_events e where e.id=event_id
      and (e.created_by=auth.uid() or public.has_workspace_role(array['manager','admin'])))
  );
revoke all on public.room7_calendar_audit from public,anon,authenticated;
grant select on public.room7_calendar_audit to authenticated;
grant all on public.room7_calendar_audit to service_role;

drop trigger if exists room7_calendar_audit_append_only on public.room7_calendar_audit;
create trigger room7_calendar_audit_append_only
  before update or delete on public.room7_calendar_audit
  for each row execute function public.collaboration_append_only();

create or replace function public.audit_room7_calendar_event()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  kind text;
begin
  if tg_op='INSERT' then kind:='created';
  elsif new.status='cancelled' and old.status is distinct from 'cancelled' then kind:='cancelled';
  else kind:='updated'; end if;
  insert into public.room7_calendar_audit(event_id,event_code,actor_id,action,snapshot)
  values(new.id,new.event_code,auth.uid(),kind,to_jsonb(new)-'organizer_email');
  return new;
end;
$$;

drop trigger if exists room7_calendar_event_audit on public.room7_calendar_events;
create trigger room7_calendar_event_audit
  after insert or update on public.room7_calendar_events
  for each row execute function public.audit_room7_calendar_event();

commit;

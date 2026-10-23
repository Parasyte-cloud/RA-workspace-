-- Collaboration alerts, task sharing/files/assigning, read-only Operations view.
--
-- 1. Collaboration: a new message now notifies everyone who can see the space.
--    Before this, only invites created notifications, so members never knew a
--    message had arrived.
-- 2. Tasks: sharing a task adds a watcher, but can_read_work_item() had lost its
--    watcher branch, so the person it was shared with could not open the task or
--    its files. The branch is restored. The attachments bucket also accepts the
--    common file types it used to refuse.
-- 3. Tasks: every active employee can assign work to every active employee.
-- 4. Operations (ArrivoOps): operations supervisors and support supervisors get
--    a read-only view of everything on the Operations centre. They cannot add,
--    edit or delete anything.
--
-- PArAsYtE

begin;

-- ------------------------------------------------------------
-- 1. COLLABORATION MESSAGE NOTIFICATIONS
-- ------------------------------------------------------------

-- Everyone who can open the space, mirroring can_access_collaboration_space().
create or replace function public.collaboration_space_audience(
  target_space uuid
)
returns table(user_id uuid)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select ep.id
  from public.collaboration_spaces s
  join public.employee_profiles ep
    on ep.active=true
  where s.id=target_space
    and s.archived_at is null
    and (
      (
        s.space_type='department'
        and nullif(lower(trim(coalesce(ep.department,''))),'') is not null
        and lower(trim(coalesce(ep.department,'')))=
            lower(trim(coalesce(s.home_department,'')))
      )
      or
      (
        s.space_type='cross_department'
        and exists(
          select 1
          from public.collaboration_space_departments d
          where d.space_id=s.id
            and d.department=lower(trim(coalesce(ep.department,'')))
        )
      )
      or
      (
        s.space_type='project'
        and exists(
          select 1
          from public.collaboration_space_members m
          where m.space_id=s.id
            and m.user_id=ep.id
        )
      )
    );
$$;

revoke all on function public.collaboration_space_audience(uuid)
from public, anon, authenticated;

create or replace function public.notify_collaboration_message()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_space text;
  v_author text;
begin
  select name into v_space
  from public.collaboration_spaces
  where id=new.space_id;

  select coalesce(nullif(trim(full_name),''),email,'A colleague')
  into v_author
  from public.employee_profiles
  where id=new.author_id;

  -- One alert per person per space every five minutes while it is unread, so
  -- a busy conversation does not bury the bell. email_status is 'skipped':
  -- chat messages are in-app alerts only.
  insert into public.notifications(
    user_id,type,title,body,entity_type,entity_id,email_status
  )
  select
    a.user_id,
    'collaboration_message',
    'New message in '||coalesce(v_space,'a shared space'),
    coalesce(v_author,'A colleague')||': '||left(trim(new.body),140),
    'collaboration_space',
    new.space_id,
    'skipped'
  from public.collaboration_space_audience(new.space_id) a
  where a.user_id<>new.author_id
    and not exists(
      select 1
      from public.notifications n
      where n.user_id=a.user_id
        and n.type='collaboration_message'
        and n.entity_id=new.space_id
        and n.read_at is null
        and n.created_at>now()-interval '5 minutes'
    );

  return new;
end;
$$;

drop trigger if exists collaboration_messages_notify
on public.collaboration_messages;

create trigger collaboration_messages_notify
after insert on public.collaboration_messages
for each row
execute function public.notify_collaboration_message();


-- ------------------------------------------------------------
-- 2. TASK SHARING: WATCHERS CAN READ THE TASK AND ITS FILES
-- ------------------------------------------------------------

create or replace function public.can_read_work_item(
  target_work_item uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.work_items w
    where
      w.id=target_work_item
      and (
        (
          w.project_space_id is null
          and (
            w.created_by=auth.uid()
            or exists(
              select 1
              from public.work_item_assignees a
              where
                a.work_item_id=w.id
                and a.assignee_id=auth.uid()
            )
            or exists(
              select 1
              from public.work_item_watchers wt
              where
                wt.work_item_id=w.id
                and wt.user_id=auth.uid()
            )
            or public.has_workspace_role(
              array['manager','admin']
            )
            or public.is_department_head_of_work(w.id)
          )
        )
        or
        (
          w.project_space_id is not null
          and public.can_access_collaboration_space(
            w.project_space_id
          )
        )
      )
  );
$$;


-- ------------------------------------------------------------
-- 3. EVERY MEMBER CAN ASSIGN TASKS TO EVERYONE
-- ------------------------------------------------------------

create or replace function public.can_assign_work(
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.employee_profiles target
      on target.id=target_user
    where
      me.id=auth.uid()
      and me.active=true
      and target.active=true
  );
$$;


-- Task file types. The bucket refused video, audio, phone photos, markdown and
-- JSON, so those uploads failed with a bare storage error. Executables and
-- scripts stay blocked.
update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif',
  'application/pdf',
  'text/plain','text/csv','text/markdown','application/json','application/rtf',
  'application/zip','application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'video/mp4','video/quicktime','audio/mpeg','audio/mp4','audio/wav'
]
where id='work-attachments';


-- ------------------------------------------------------------
-- 4. OPERATIONS: READ-ONLY VIEW FOR SUPERVISORS
-- ------------------------------------------------------------

-- Operations supervisor: anyone whose job title is a head, lead, manager or
-- supervisor of operations. Support supervisors come from support_is_supervisor().
create or replace function public.ops_is_supervisor(
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select p_user is not null and exists(
    select 1
    from public.employee_profiles ep
    where ep.id=p_user
      and ep.active
      and lower(ep.job_title) ~
        '(head of operations|operations (lead|manager|supervisor)|(lead|manager|supervisor) of operations)'
  );
$$;

-- 'write'    role already allows editing (operations, manager, admin)
-- 'readonly' a supervisor without one of those roles
-- 'none'     no access
create or replace function public.operations_access_mode()
returns text
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select case
    when auth.uid() is null then 'none'
    when public.has_workspace_role(array['operations','manager','admin'])
      then 'write'
    when public.ops_is_supervisor(auth.uid())
      or public.support_is_supervisor(auth.uid())
      then 'readonly'
    else 'none'
  end;
$$;

create or replace function public.operations_can_view()
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select public.operations_access_mode() in ('write','readonly');
$$;

revoke all on function public.ops_is_supervisor(uuid) from public, anon;
revoke all on function public.operations_access_mode() from public, anon;
revoke all on function public.operations_can_view() from public, anon;
grant execute on function public.ops_is_supervisor(uuid) to authenticated;
grant execute on function public.operations_access_mode() to authenticated;
grant execute on function public.operations_can_view() to authenticated;

-- SELECT only. Writes stay behind the existing operations/manager/admin policies.
do $$
declare
  t text;
begin
  foreach t in array array[
    'operations_driver_shifts',
    'operations_fleet_maintenance',
    'operations_vehicle_inspections',
    'operations_flight_watch',
    'operations_receipts',
    'incidents'
  ] loop
    execute format(
      'drop policy if exists "operations supervisor read" on public.%I',t
    );
    execute format(
      'create policy "operations supervisor read" on public.%I '
      'for select to authenticated '
      'using (public.operations_access_mode() = ''readonly'')',
      t
    );
  end loop;
end;
$$;

drop policy if exists "operations receipt audit supervisor read"
on public.operations_receipt_audit;

create policy "operations receipt audit supervisor read"
on public.operations_receipt_audit
for select
to authenticated
using (public.operations_access_mode()='readonly');

drop policy if exists "operations receipts storage supervisor read"
on storage.objects;

create policy "operations receipts storage supervisor read"
on storage.objects
for select
to authenticated
using (
  bucket_id='operations-receipts'
  and public.operations_access_mode()='readonly'
);

commit;

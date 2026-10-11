-- Notifications for chat messages and announcements.
--
-- Until now nothing created a notification when someone sent a chat message or
-- an announcement was published, so the bell stayed silent. This adds database
-- triggers (so it works no matter which screen or API creates the row):
--
--   1. A new chat message notifies the other people in that conversation.
--      There is one notification per conversation, not one per message: more
--      messages update the same row ("3 new messages") so the bell is not
--      flooded. These do not send an email, because an email per chat message
--      would be spam.
--   2. Reading a conversation clears its notification.
--   3. Publishing an announcement (Announcements page) notifies every active
--      employee in its audience, and an "announcement" post on Pulse notifies
--      the people who can see it. These do send the normal notification email.
--
-- Safe to run twice.

begin;

-- 1. New chat message -> one running notification per conversation.
create or replace function public.notify_social_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender_name text;
  recipient record;
  existing uuid;
  unread_count int;
  preview text := left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 140);
begin
  select coalesce(nullif(btrim(full_name), ''), email) into sender_name
  from public.employee_profiles where id = new.sender_id;

  for recipient in
    select m.user_id
    from public.social_conversation_members m
    join public.employee_profiles p on p.id = m.user_id and p.active = true
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender_id
  loop
    select n.id into existing
    from public.notifications n
    where n.user_id = recipient.user_id
      and n.type = 'chat_message'
      and n.entity_id = new.conversation_id
      and n.read_at is null
    order by n.created_at desc
    limit 1;

    if existing is null then
      insert into public.notifications(
        user_id, type, title, body, entity_type, entity_id, email_status
      ) values (
        recipient.user_id, 'chat_message', coalesce(sender_name, 'New message'),
        preview, 'social_conversation', new.conversation_id, 'skipped'
      );
    else
      select count(*) into unread_count
      from public.social_messages sm
      join public.social_conversation_members me
        on me.conversation_id = sm.conversation_id and me.user_id = recipient.user_id
      where sm.conversation_id = new.conversation_id
        and sm.sender_id <> recipient.user_id
        and sm.created_at > me.last_read_at;

      update public.notifications
      set title = coalesce(sender_name, 'New message')
                  || case when unread_count > 1 then ' (' || unread_count || ' new messages)' else '' end,
          body = preview,
          created_at = now()
      where id = existing;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_social_message() from public, anon, authenticated;

drop trigger if exists notify_social_message on public.social_messages;
create trigger notify_social_message
after insert on public.social_messages
for each row execute function public.notify_social_message();

-- 2. Reading a conversation clears its notification.
create or replace function public.clear_chat_notification_on_read()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.last_read_at is distinct from old.last_read_at then
    delete from public.notifications
    where user_id = new.user_id
      and type = 'chat_message'
      and entity_id = new.conversation_id;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_chat_notification_on_read() from public, anon, authenticated;

drop trigger if exists clear_chat_notification_on_read on public.social_conversation_members;
create trigger clear_chat_notification_on_read
after update of last_read_at on public.social_conversation_members
for each row execute function public.clear_chat_notification_on_read();

-- 3a. Announcements page: notify the audience when one is published.
create or replace function public.notify_workspace_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.published is true
     and (tg_op = 'INSERT' or old.published is distinct from true) then
    insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
    select p.id, 'announcement', new.title, left(coalesce(new.body, ''), 200),
           'workspace_announcement', new.id
    from public.employee_profiles p
    where p.active = true
      and p.id is distinct from new.employee_id
      and (coalesce(array_length(new.audience_roles, 1), 0) = 0
           or lower(p.role) = any (select lower(r) from unnest(new.audience_roles) r))
      and (coalesce(array_length(new.audience_departments, 1), 0) = 0
           or lower(p.department) = any (select lower(d) from unnest(new.audience_departments) d));
  end if;
  return new;
end;
$$;

revoke all on function public.notify_workspace_announcement() from public, anon, authenticated;

drop trigger if exists notify_workspace_announcement on public.workspace_announcements;
create trigger notify_workspace_announcement
after insert or update of published on public.workspace_announcements
for each row execute function public.notify_workspace_announcement();

-- 3b. Pulse: an "announcement" post notifies the people who can see it.
create or replace function public.notify_social_announcement_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  author_department text;
begin
  if new.post_type <> 'announcement' or new.deleted_at is not null or new.scheduled_for is not null then
    return new;
  end if;

  select department into author_department from public.employee_profiles where id = new.author_id;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
  select p.id, 'announcement', 'New announcement', left(new.body, 200), 'social_post', new.id
  from public.employee_profiles p
  where p.active = true
    and p.id <> new.author_id
    and (
      new.visibility = 'employees'
      or (new.visibility = 'department' and p.department is not distinct from author_department)
      or (new.visibility = 'leadership' and lower(p.role) in ('admin', 'manager', 'cto'))
    );

  return new;
end;
$$;

revoke all on function public.notify_social_announcement_post() from public, anon, authenticated;

drop trigger if exists notify_social_announcement_post on public.social_posts;
create trigger notify_social_announcement_post
after insert on public.social_posts
for each row execute function public.notify_social_announcement_post();

commit;

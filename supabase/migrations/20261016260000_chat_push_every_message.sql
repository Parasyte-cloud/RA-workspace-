begin;

-- Until now only the first unread message in a chat sent a phone alert. The
-- next messages update the same notification row (so the bell stays tidy) and
-- an insert-only trigger never saw them. Send an alert for every new message,
-- like WhatsApp. Muted chats never reach here: skip_muted_chat_notification
-- already stops their rows.

drop trigger if exists notifications_push_bumped on public.notifications;
create trigger notifications_push_bumped
  after update of created_at on public.notifications
  for each row
  when (
    new.type in ('chat_message', 'chat_mention')
    and new.read_at is null
    and new.created_at > old.created_at
  )
  execute function public.push_on_notification();

commit;

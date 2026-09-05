begin;

-- Operations shares the existing Support WhatsApp communications
-- channel without receiving the wider Support workstation.
--
-- Authenticated clients remain SELECT-only on these tables.
-- Outbound messages continue through the whatsapp-send Edge Function,
-- where actor authorization and the customer destination are resolved
-- server-side.

drop policy if exists
  "support whatsapp conversations authorised read"
on public.support_whatsapp_conversations;

create policy
  "support whatsapp conversations authorised read"
on public.support_whatsapp_conversations
for select
to authenticated
using (
  public.has_workspace_role(
    array['support','operations','manager','admin']
  )
  or public.has_workstation_access(array['support'])
);

drop policy if exists
  "support whatsapp messages authorised read"
on public.support_whatsapp_messages;

create policy
  "support whatsapp messages authorised read"
on public.support_whatsapp_messages
for select
to authenticated
using (
  public.has_workspace_role(
    array['support','operations','manager','admin']
  )
  or public.has_workstation_access(array['support'])
);

commit;

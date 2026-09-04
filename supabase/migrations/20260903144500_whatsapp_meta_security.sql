begin;

create table if not exists public.support_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,
  phone text,
  customer_name text not null default 'WhatsApp Customer',
  status text not null default 'open'
    check (status in ('open','closed')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.support_whatsapp_conversations(id)
    on delete cascade,
  whatsapp_message_id text,
  direction text not null
    check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  body text not null default '',
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists
  support_whatsapp_messages_message_id_unique
on public.support_whatsapp_messages(whatsapp_message_id);

create index if not exists
  support_whatsapp_messages_conversation_created_idx
on public.support_whatsapp_messages(conversation_id, created_at desc);

alter table public.support_whatsapp_conversations
  enable row level security;

alter table public.support_whatsapp_messages
  enable row level security;

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
    array['support','manager','admin']
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
    array['support','manager','admin']
  )
  or public.has_workstation_access(array['support'])
);

revoke all on public.support_whatsapp_conversations
from public, anon, authenticated;

revoke all on public.support_whatsapp_messages
from public, anon, authenticated;

grant select on public.support_whatsapp_conversations
to authenticated;

grant select on public.support_whatsapp_messages
to authenticated;

grant all on public.support_whatsapp_conversations
to service_role;

grant all on public.support_whatsapp_messages
to service_role;

commit;

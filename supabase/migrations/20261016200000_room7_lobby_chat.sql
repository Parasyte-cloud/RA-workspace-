-- ROOM 7: waiting room chat. Guests who are waiting for the host to admit
-- them can chat with the host (and each other) until they are let in.
-- Only the edge functions touch this table (service role), so there is no
-- public access at all. Safe to run twice.

begin;

create table if not exists public.room7_lobby_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  author_kind text not null check (author_kind in ('guest', 'host')),
  author_name text not null check (char_length(author_name) between 1 and 80),
  request_id uuid references public.room7_join_requests(id) on delete set null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists room7_lobby_messages_room_idx
  on public.room7_lobby_messages (room_id, created_at desc);

alter table public.room7_lobby_messages enable row level security;
revoke all on public.room7_lobby_messages from public, anon, authenticated;
grant all on public.room7_lobby_messages to service_role;

commit;

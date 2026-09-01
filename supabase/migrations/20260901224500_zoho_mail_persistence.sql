begin;

-- ============================================================
-- RideArrivo Zoho Mail persistence
-- Server-only OAuth state and mailbox connection credentials.
-- ============================================================

create table if not exists public.zoho_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint zoho_oauth_states_state_not_blank
    check (length(btrim(state)) > 0),
  constraint zoho_oauth_states_expiry_after_creation
    check (expires_at > created_at)
);

create index if not exists zoho_oauth_states_user_id_idx
  on public.zoho_oauth_states(user_id);

create index if not exists zoho_oauth_states_expires_at_idx
  on public.zoho_oauth_states(expires_at);

create table if not exists public.zoho_mail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  zoho_account_id text not null,
  refresh_token text not null,
  accounts_domain text not null default 'https://accounts.zoho.com',
  mail_api_base text not null default 'https://mail.zoho.com/api',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zoho_mail_connections_account_not_blank
    check (length(btrim(zoho_account_id)) > 0),
  constraint zoho_mail_connections_refresh_not_blank
    check (length(btrim(refresh_token)) > 0)
);

drop trigger if exists zoho_mail_connections_set_updated_at
  on public.zoho_mail_connections;

create trigger zoho_mail_connections_set_updated_at
before update on public.zoho_mail_connections
for each row
execute function public.set_updated_at();

alter table public.zoho_oauth_states enable row level security;
alter table public.zoho_mail_connections enable row level security;

revoke all on table public.zoho_oauth_states
  from public, anon, authenticated;

revoke all on table public.zoho_mail_connections
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.zoho_oauth_states
  to service_role;

grant select, insert, update, delete
  on table public.zoho_mail_connections
  to service_role;

comment on table public.zoho_oauth_states is
  'Server-only, short-lived OAuth state for Zoho Mail authorization.';

comment on table public.zoho_mail_connections is
  'Server-only Zoho Mail connection metadata and refresh token. Never expose refresh_token to browser clients.';

comment on column public.zoho_mail_connections.refresh_token is
  'Long-lived Zoho OAuth credential. Service-role access only.';

commit;

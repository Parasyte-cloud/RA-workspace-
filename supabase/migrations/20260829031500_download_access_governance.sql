begin;

create table if not exists public.workspace_download_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.employee_profiles(id) on delete cascade,
  resource_type text not null,
  resource_key text not null,
  resource_name text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','denied','revoked')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.employee_profiles(id) on delete set null,
  reviewed_at timestamptz,
  decision_note text,
  grant_expires_at timestamptz,
  last_downloaded_at timestamptz,
  download_count integer not null default 0 check (download_count >= 0)
);

create index if not exists workspace_download_requests_requester_idx on public.workspace_download_requests(requester_id,requested_at desc);
create index if not exists workspace_download_requests_status_idx on public.workspace_download_requests(status,requested_at desc);
create index if not exists workspace_download_requests_resource_idx on public.workspace_download_requests(resource_type,resource_key,requester_id);
create unique index if not exists workspace_download_requests_one_pending_idx on public.workspace_download_requests(requester_id,resource_type,resource_key) where status='pending';

alter table public.workspace_download_requests enable row level security;

create or replace function public.is_workspace_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.employee_profiles ep
    where ep.id=auth.uid() and ep.active=true and ep.role='admin'
  );
$$;

grant execute on function public.is_workspace_admin() to authenticated;

create or replace function public.has_workspace_download_access(p_resource_type text,p_resource_key text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    public.is_workspace_admin()
    or exists(
      select 1
      from public.workspace_download_requests r
      join public.employee_profiles ep on ep.id=r.requester_id
      where r.requester_id=auth.uid()
        and ep.active=true
        and r.resource_type=p_resource_type
        and r.resource_key=p_resource_key
        and r.status='approved'
        and (r.grant_expires_at is null or r.grant_expires_at>now())
    );
$$;

grant execute on function public.has_workspace_download_access(text,text) to authenticated;

create or replace function public.request_workspace_download(
  p_resource_type text,
  p_resource_key text,
  p_resource_name text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  request_id uuid;
begin
  if not exists(select 1 from public.employee_profiles where id=auth.uid() and active=true) then
    raise exception 'Only active employees can request downloads';
  end if;

  if public.has_workspace_download_access(p_resource_type,p_resource_key) then
    select id into request_id
    from public.workspace_download_requests
    where requester_id=auth.uid()
      and resource_type=p_resource_type
      and resource_key=p_resource_key
      and status='approved'
      and (grant_expires_at is null or grant_expires_at>now())
    order by reviewed_at desc nulls last
    limit 1;
    return request_id;
  end if;

  select id into request_id
  from public.workspace_download_requests
  where requester_id=auth.uid()
    and resource_type=p_resource_type
    and resource_key=p_resource_key
    and status='pending'
  limit 1;

  if request_id is not null then return request_id; end if;

  insert into public.workspace_download_requests(requester_id,resource_type,resource_key,resource_name,reason)
  values(auth.uid(),trim(p_resource_type),trim(p_resource_key),trim(p_resource_name),nullif(trim(coalesce(p_reason,'')),''))
  returning id into request_id;

  return request_id;
end;
$$;

grant execute on function public.request_workspace_download(text,text,text,text) to authenticated;

create or replace function public.review_workspace_download_request(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null,
  p_grant_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_workspace_admin() then raise exception 'Administrator access required'; end if;
  if p_decision not in ('approved','denied','revoked') then raise exception 'Invalid download decision'; end if;

  update public.workspace_download_requests
  set status=p_decision,
      reviewed_by=auth.uid(),
      reviewed_at=now(),
      decision_note=nullif(trim(coalesce(p_decision_note,'')),''),
      grant_expires_at=case when p_decision='approved' then coalesce(p_grant_expires_at,now()+interval '24 hours') else null end
  where id=p_request_id;

  if not found then raise exception 'Download request not found'; end if;
end;
$$;

grant execute on function public.review_workspace_download_request(uuid,text,text,timestamptz) to authenticated;

create or replace function public.record_workspace_download(p_resource_type text,p_resource_key text)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_workspace_download_access(p_resource_type,p_resource_key) then
    raise exception 'Download access has not been approved';
  end if;

  if public.is_workspace_admin() then return; end if;

  update public.workspace_download_requests
  set download_count=download_count+1,last_downloaded_at=now()
  where id=(
    select id from public.workspace_download_requests
    where requester_id=auth.uid()
      and resource_type=p_resource_type
      and resource_key=p_resource_key
      and status='approved'
      and (grant_expires_at is null or grant_expires_at>now())
    order by reviewed_at desc nulls last
    limit 1
  );
end;
$$;

grant execute on function public.record_workspace_download(text,text) to authenticated;

drop policy if exists "download requests own read" on public.workspace_download_requests;
create policy "download requests own read" on public.workspace_download_requests for select to authenticated using(requester_id=auth.uid() or public.is_workspace_admin());

revoke all on public.workspace_download_requests from anon;
revoke insert,update,delete on public.workspace_download_requests from authenticated;
grant select on public.workspace_download_requests to authenticated;

-- Original brand files are not readable until an administrator grants download access.
drop policy if exists "brand storage active employees read" on storage.objects;
drop policy if exists "brand storage governed read" on storage.objects;
create policy "brand storage governed read" on storage.objects for select to authenticated using(
  bucket_id='brand-assets'
  and (
    public.is_workspace_admin()
    or exists(
      select 1 from public.brand_assets b
      where b.storage_path=storage.objects.name
        and b.is_active=true
        and public.has_workspace_download_access('brand_asset',b.id::text)
    )
  )
);

-- Controlled text downloads are stored in Postgres so they are not publicly reachable by URL.
create table if not exists public.workspace_controlled_text_assets(
  asset_key text primary key,
  file_name text not null,
  mime_type text not null default 'text/plain',
  content text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.workspace_controlled_text_assets enable row level security;
revoke all on public.workspace_controlled_text_assets from anon,authenticated;

insert into public.workspace_controlled_text_assets(asset_key,file_name,mime_type,content)
values
('macos-bootstrap','ridearrivo-macos-setup.sh','text/x-shellscript',E'#!/usr/bin/env bash\nset -euo pipefail\n\ncommand -v brew >/dev/null 2>&1 || { echo "Homebrew is required."; exit 1; }\nbrew install git gh node\nbrew install --cask visual-studio-code docker postman android-studio\nnpm install -g eas-cli supabase\necho "RideArrivo engineering bootstrap complete."\n'),
('windows-bootstrap','ridearrivo-windows-setup.ps1','text/plain',E'$ErrorActionPreference = "Stop"\nwinget install --id Git.Git -e --accept-package-agreements --accept-source-agreements\nwinget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements\nwinget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements\nwinget install --id Microsoft.VisualStudioCode -e --accept-package-agreements --accept-source-agreements\nwinget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements\nwinget install --id Postman.Postman -e --accept-package-agreements --accept-source-agreements\nwinget install --id Google.AndroidStudio -e --accept-package-agreements --accept-source-agreements\nnpm install -g eas-cli supabase\nWrite-Host "RideArrivo engineering bootstrap complete."\n')
on conflict(asset_key) do update set file_name=excluded.file_name,mime_type=excluded.mime_type,content=excluded.content,active=true,updated_at=now();

create or replace function public.get_controlled_text_asset(p_asset_key text)
returns table(file_name text,mime_type text,content text)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_workspace_download_access('engineering_asset',p_asset_key) then
    raise exception 'Download access has not been approved';
  end if;
  return query select a.file_name,a.mime_type,a.content from public.workspace_controlled_text_assets a where a.asset_key=p_asset_key and a.active=true;
end;
$$;

grant execute on function public.get_controlled_text_asset(text) to authenticated;

commit;

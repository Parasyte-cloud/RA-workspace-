begin;

-- Headshots are account-owner-only identity assets.
alter table public.employee_headshots enable row level security;

drop policy if exists "active employees read headshots" on public.employee_headshots;
drop policy if exists "employees read own headshots" on public.employee_headshots;
create policy "employees read own headshots" on public.employee_headshots for select to authenticated using (
  employee_id = auth.uid() and exists (select 1 from public.employee_profiles me where me.id=auth.uid() and me.active=true)
);

drop policy if exists "employees upload own headshots" on public.employee_headshots;
create policy "employees upload own headshots" on public.employee_headshots for insert to authenticated with check (
  employee_id=auth.uid() and storage_path like auth.uid()::text || '/%' and exists (select 1 from public.employee_profiles me where me.id=auth.uid() and me.active=true)
);

drop policy if exists "employees delete own headshots" on public.employee_headshots;
create policy "employees delete own headshots" on public.employee_headshots for delete to authenticated using (
  employee_id=auth.uid() and exists (select 1 from public.employee_profiles me where me.id=auth.uid() and me.active=true)
);

revoke all on public.employee_headshots from anon;
revoke update on public.employee_headshots from authenticated;
grant select,insert,delete on public.employee_headshots to authenticated;

update storage.buckets set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='employee-headshots';

drop policy if exists "active employees view headshot files" on storage.objects;
drop policy if exists "employees view own headshot files" on storage.objects;
create policy "employees view own headshot files" on storage.objects for select to authenticated using (
  bucket_id='employee-headshots' and (storage.foldername(name))[1]=auth.uid()::text and exists (select 1 from public.employee_profiles me where me.id=auth.uid() and me.active=true)
);

drop policy if exists "employees upload own headshot files" on storage.objects;
create policy "employees upload own headshot files" on storage.objects for insert to authenticated with check (
  bucket_id='employee-headshots' and (storage.foldername(name))[1]=auth.uid()::text and exists (select 1 from public.employee_profiles me where me.id=auth.uid() and me.active=true)
);

drop policy if exists "employees delete own headshot files" on storage.objects;
create policy "employees delete own headshot files" on storage.objects for delete to authenticated using (
  bucket_id='employee-headshots' and (storage.foldername(name))[1]=auth.uid()::text and exists (select 1 from public.employee_profiles me where me.id=auth.uid() and me.active=true)
);

do $$ begin
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='employee_headshots') then
    alter publication supabase_realtime drop table public.employee_headshots;
  end if;
end $$;

commit;

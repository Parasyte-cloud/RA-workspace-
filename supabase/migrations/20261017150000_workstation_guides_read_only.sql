-- Workstation guides become read-only for everyone using the app.
--
-- Until now legal and admin users could replace a guide PDF from the dashboard
-- ("Replace guide (PDF)"), backed by insert/update/delete policies on the
-- workstation-guides bucket. The guides are now published by the engineering
-- team from the repository (supabase/guides, scripts/upload-workstation-guides.sh),
-- so no signed-in user needs write access, and none should have it.
--
-- Dropping these policies means a signed-in browser or API client can no longer
-- insert, overwrite or delete a guide, even by calling storage directly. The
-- service role (the Supabase dashboard and the CLI) bypasses row level security,
-- so publishing from the repository keeps working.
--
-- The read policy is unchanged: every active employee can read any
-- '<slug>/readme.pdf', which is how the in-workspace viewer loads a guide.
begin;

drop policy if exists "workstation guide legal admin insert" on storage.objects;
drop policy if exists "workstation guide legal admin update" on storage.objects;
drop policy if exists "workstation guide legal admin delete" on storage.objects;

commit;

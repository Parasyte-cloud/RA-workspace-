-- Behaviour check for can_read_workstation_guide (20261017170000). Needs a scratch Postgres with stub auth/storage objects
-- (see supabase/checks/r7-ai-hardening.sql for the same setup style) and the workstation assignments table.
create table if not exists public.workspace_workstation_assignments(id uuid default gen_random_uuid(), employee_id uuid, workstation text, is_primary boolean default true, active boolean default true);
delete from public.employee_profiles; delete from public.workspace_workstation_assignments;
insert into public.employee_profiles(id,full_name,email,role,active) values
 ('00000000-0000-0000-0000-0000000000b1','Support Sam','s@x','support',true),
 ('00000000-0000-0000-0000-0000000000b2','Eng Eve','e@x','engineer',true),
 ('00000000-0000-0000-0000-0000000000b3','Mgr Max','m@x','manager',true),
 ('00000000-0000-0000-0000-0000000000b4','Admin Ada','a@x','admin',true),
 ('00000000-0000-0000-0000-0000000000b5','Plain Pat','p@x','employee',true),
 ('00000000-0000-0000-0000-0000000000b6','Gone Gil','g@x','support',false),
 ('00000000-0000-0000-0000-0000000000b7','Assigned Al','l@x','employee',true);
insert into public.workspace_workstation_assignments(employee_id,workstation,is_primary,active) values
 ('00000000-0000-0000-0000-0000000000b7','finance',true,true),
 ('00000000-0000-0000-0000-0000000000b5','legal',true,false);
create or replace function pg_temp.can(uid text, obj text) returns boolean language plpgsql as $$
begin perform set_config('test.uid',uid,false); return public.can_read_workstation_guide(obj); end $$;
do $$ declare ok int:=0;
 procedure_dummy int;
begin
 -- own guide yes, other guides no
 if pg_temp.can('00000000-0000-0000-0000-0000000000b1','support/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b1','finance/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b1','legal/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b1','administration/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b1','executive/readme.pdf') then ok:=ok+1; else raise exception 'FAIL support'; end if;
 -- engineer: engineering + linux, nothing else
 if pg_temp.can('00000000-0000-0000-0000-0000000000b2','engineering/readme.pdf') and pg_temp.can('00000000-0000-0000-0000-0000000000b2','linux/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b2','finance/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b2','support/readme.pdf') then ok:=ok+1; else raise exception 'FAIL eng'; end if;
 -- manager follows the app: executive and the departments managers can open
 if pg_temp.can('00000000-0000-0000-0000-0000000000b3','executive/readme.pdf') and pg_temp.can('00000000-0000-0000-0000-0000000000b3','finance/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b3','administration/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b3','linux/readme.pdf') then ok:=ok+1; else raise exception 'FAIL manager'; end if;
 -- admin sees all
 if pg_temp.can('00000000-0000-0000-0000-0000000000b4','administration/readme.pdf') and pg_temp.can('00000000-0000-0000-0000-0000000000b4','legal/readme.pdf') and pg_temp.can('00000000-0000-0000-0000-0000000000b4','driver-guide/readme.pdf') then ok:=ok+1; else raise exception 'FAIL admin'; end if;
 -- plain employee: general guide only; inactive assignment gives nothing
 if pg_temp.can('00000000-0000-0000-0000-0000000000b5','canonical/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b5','support/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b5','legal/readme.pdf') then ok:=ok+1; else raise exception 'FAIL plain'; end if;
 -- inactive employee: nothing, not even canonical
 if not pg_temp.can('00000000-0000-0000-0000-0000000000b6','canonical/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b6','support/readme.pdf') then ok:=ok+1; else raise exception 'FAIL inactive'; end if;
 -- active assignment grants that workstation only
 if pg_temp.can('00000000-0000-0000-0000-0000000000b7','finance/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b7','people/readme.pdf') then ok:=ok+1; else raise exception 'FAIL assignment'; end if;
 -- signed out, odd names, unknown slugs
 if not pg_temp.can('','canonical/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b4','../support/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b4','support/x/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b4','nothing/readme.pdf') and not pg_temp.can('00000000-0000-0000-0000-0000000000b4','support/readme.pdf.bak') and not pg_temp.can('00000000-0000-0000-0000-0000000000b4',null) then ok:=ok+1; else raise exception 'FAIL odd'; end if;
 raise notice 'guide access checks passed: % of 8', ok;
end $$;
-- the policy is in place and the old broad one is gone
do $$ begin
 if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='workstation guide active employee read') then raise exception 'old policy still present'; end if;
 if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='workstation guide own workstation read') then raise exception 'new policy missing'; end if;
 raise notice 'policy swap ok';
end $$;

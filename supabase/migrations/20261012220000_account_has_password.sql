-- Does the signed in person have a password?
--
-- Why: an invitation email signs a new employee in without asking for a
-- password. The session works for a while, then expires, and from then on they
-- cannot sign in because no password was ever set. An administrator has to send
-- a reset. The app now calls this right after sign-in and, when the answer is
-- false, makes the person choose a password before anything else.
--
-- It only ever answers about the caller, and only yes or no. It never exposes
-- the password hash. If the account row cannot be read it answers true so
-- nobody is ever locked out by a mistake here.
--
-- Safe to run twice.

begin;

create or replace function public.my_account_has_password()
returns boolean
language sql
stable
security definer
set search_path = auth, public, pg_temp
as $$
  select coalesce(
    (select coalesce(u.encrypted_password, '') <> ''
     from auth.users u
     where u.id = auth.uid()),
    true
  );
$$;

revoke all on function public.my_account_has_password() from public, anon;
grant execute on function public.my_account_has_password() to authenticated;

commit;

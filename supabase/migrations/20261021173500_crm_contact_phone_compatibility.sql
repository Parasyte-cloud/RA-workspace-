begin;

-- Shared CRM compatibility:
-- existing canonical contact phone is public.crm_contacts.phone
-- standalone CRM V1/V2 code still references phone_e164 and related fields.

alter table public.crm_contacts
  add column if not exists phone_e164 text,
  add column if not exists secondary_phone_e164 text,
  add column if not exists area text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill the compatibility phone from the canonical phone column.
update public.crm_contacts
set phone_e164 = phone
where phone_e164 is null
  and phone is not null;

-- Backfill the canonical phone where legacy rows only have phone_e164.
update public.crm_contacts
set phone = phone_e164
where phone is null
  and phone_e164 is not null;

create unique index if not exists crm_contacts_phone_e164_unique_idx
on public.crm_contacts(phone_e164)
where phone_e164 is not null;

create or replace function public.crm_contacts_sync_phone_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.phone_e164 is null and new.phone is not null then
      new.phone_e164 := new.phone;
    elsif new.phone is null and new.phone_e164 is not null then
      new.phone := new.phone_e164;
    elsif new.phone is not null
       and new.phone_e164 is not null
       and new.phone is distinct from new.phone_e164 then
      -- Standalone CRM compatibility value wins on insert.
      new.phone := new.phone_e164;
    end if;
  else
    if new.phone_e164 is distinct from old.phone_e164
       and new.phone_e164 is not null then
      new.phone := new.phone_e164;
    elsif new.phone is distinct from old.phone
       and new.phone is not null then
      new.phone_e164 := new.phone;
    end if;
  end if;

  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists crm_contacts_sync_phone_columns
on public.crm_contacts;

create trigger crm_contacts_sync_phone_columns
before insert or update
on public.crm_contacts
for each row
execute function public.crm_contacts_sync_phone_columns();

-- Keep compatibility fields private behind existing RLS.
revoke all on public.crm_contacts from anon;

commit;

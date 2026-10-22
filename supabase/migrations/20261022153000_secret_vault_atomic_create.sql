begin;

create or replace function public.vault_create_encrypted_item(
  target_item uuid,
  target_owner uuid,
  item_label text,
  item_kind text,
  item_classification text,
  item_mime_type text,
  item_original_filename text,
  item_byte_size bigint,
  item_last_four text,
  item_reveal_max_seconds integer,
  item_owner_approval_for_others boolean,
  ciphertext_base64 text,
  iv_base64 text,
  payload_aad text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  new_item_id uuid := target_item;
  decoded_ciphertext bytea;
  decoded_iv bytea;
begin
  if target_item is null then
    raise exception 'Vault item ID is required';
  end if;

  if target_owner is null then
    raise exception 'Vault owner is required';
  end if;

  if not exists (
    select 1
    from public.employee_profiles p
    where p.id = target_owner
      and p.active = true
  ) then
    raise exception 'Active Vault owner required';
  end if;

  if item_label is null
     or char_length(trim(item_label)) < 1
     or char_length(trim(item_label)) > 200 then
    raise exception 'Invalid Vault label';
  end if;

  if item_kind not in ('text', 'number', 'document') then
    raise exception 'Invalid Vault item kind';
  end if;

  if item_byte_size is null
     or item_byte_size < 1
     or item_byte_size > 15728640 then
    raise exception 'Invalid Vault item size';
  end if;

  if item_reveal_max_seconds < 5
     or item_reveal_max_seconds > 600 then
    raise exception 'Invalid reveal window';
  end if;

  if payload_aad is null
     or char_length(payload_aad) < 1
     or char_length(payload_aad) > 512 then
    raise exception 'Invalid payload AAD';
  end if;

  begin
    decoded_ciphertext := decode(ciphertext_base64, 'base64');
    decoded_iv := decode(iv_base64, 'base64');
  exception
    when others then
      raise exception 'Invalid encrypted payload encoding';
  end;

  if octet_length(decoded_iv) <> 12 then
    raise exception 'Invalid encryption IV';
  end if;

  if octet_length(decoded_ciphertext) < 17
     or octet_length(decoded_ciphertext) > 15728656 then
    raise exception 'Invalid encrypted payload size';
  end if;

  insert into public.secret_vault_items (
    id,
    owner_id,
    label,
    kind,
    classification,
    mime_type,
    original_filename,
    byte_size,
    last_four,
    reveal_max_seconds,
    owner_approval_for_others
  )
  values (
    new_item_id,
    target_owner,
    trim(item_label),
    item_kind,
    item_classification,
    item_mime_type,
    item_original_filename,
    item_byte_size,
    item_last_four,
    item_reveal_max_seconds,
    item_owner_approval_for_others
  );

  insert into private.secret_vault_payloads (
    item_id,
    ciphertext,
    iv,
    aad
  )
  values (
    new_item_id,
    decoded_ciphertext,
    decoded_iv,
    payload_aad
  );

  return new_item_id;
end;
$$;

revoke all
on function public.vault_create_encrypted_item(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  integer,
  boolean,
  text,
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.vault_create_encrypted_item(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text,
  integer,
  boolean,
  text,
  text,
  text
)
to service_role;

notify pgrst, 'reload schema';

commit;

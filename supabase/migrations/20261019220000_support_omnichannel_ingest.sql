-- PArAsYtE | RA-Workspace support module
-- RA Support Command Centre: automatic ticketing for the channels RA-Workspace
-- already receives (WhatsApp conversations and Support intake forms), plus
-- realtime publication for the live UI. Idempotent.
--
-- Both ingest triggers swallow their own errors. Ticketing is an add-on to
-- those pipelines; it must never be able to make a WhatsApp message or a form
-- submission fail to save.

begin;

-- ---------------------------------------------------------------------------
-- 1. WhatsApp conversations -> tickets
-- ---------------------------------------------------------------------------

create or replace function public.support_wa_message_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.support_whatsapp_conversations%rowtype;
  v_digits text;
  v_phone text;
  v_name text;
  v_body text;
begin
  begin
    select * into v_conv from public.support_whatsapp_conversations where id = new.conversation_id;
    if not found then return new; end if;

    v_digits := regexp_replace(coalesce(nullif(v_conv.wa_id, ''), v_conv.phone, ''), '[^0-9]', '', 'g');
    v_phone := case when v_digits <> '' then public.support_normalize_phone('+' || v_digits) end;
    v_name := nullif(btrim(coalesce(v_conv.customer_name, '')), '');
    if v_name = 'WhatsApp Customer' then v_name := null; end if;
    v_body := coalesce(nullif(btrim(new.body), ''), '[' || coalesce(new.message_type, 'message') || ']');

    perform public.support_ingest_interaction(
      'whatsapp',
      new.direction,
      'whatsapp',
      coalesce(nullif(new.whatsapp_message_id, ''), new.id::text),
      case when v_phone is null then 'external' else 'phone' end,
      coalesce(v_phone, 'wa:' || coalesce(v_conv.wa_id, v_conv.id::text)),
      v_name,
      null,
      v_body,
      jsonb_build_object('message_type', new.message_type, 'conversation_id', new.conversation_id),
      'wa:' || new.conversation_id::text,
      null, null, '[]'::jsonb,
      new.created_at
    );
  exception when others then
    raise warning 'support_wa_message_to_ticket failed: %', sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Support intake forms -> tickets
-- ---------------------------------------------------------------------------

create or replace function public.support_intake_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb := coalesce(new.payload, '{}'::jsonb);
  v_phone text;
  v_email text;
  v_name text;
  v_body text;
  v_type text;
  v_value text;
  v_extra jsonb := '[]'::jsonb;
  v_category text;
begin
  if new.destination_workstation is distinct from 'support' then return new; end if;
  begin
    v_phone := public.support_normalize_phone(coalesce(
      v_payload ->> 'phone', v_payload ->> 'phone_number', v_payload ->> 'mobile',
      v_payload ->> 'whatsapp', v_payload ->> 'telephone'));
    v_email := nullif(lower(btrim(coalesce(v_payload ->> 'email', v_payload ->> 'email_address', ''))), '');
    v_name := nullif(btrim(coalesce(
      v_payload ->> 'full_name', v_payload ->> 'name',
      concat_ws(' ', v_payload ->> 'first_name', v_payload ->> 'last_name'))), '');

    select left(string_agg(t.k || ': ' || left(t.v, 600), E'\n' order by t.k), 4000) into v_body
      from jsonb_each_text(v_payload) as t(k, v)
     where jsonb_typeof(v_payload -> t.k) in ('string','number','boolean') and btrim(t.v) <> '';

    if v_phone is not null then
      v_type := 'phone'; v_value := v_phone;
      if v_email is not null then v_extra := jsonb_build_array(jsonb_build_object('type','email','value',v_email)); end if;
    elsif v_email is not null then
      v_type := 'email'; v_value := v_email;
    else
      v_type := 'external'; v_value := 'intake:' || new.id::text;
    end if;

    v_category := case when lower(coalesce(new.category_title_snapshot, '')) like '%complaint%' then 'complaint' end;

    perform public.support_ingest_interaction(
      'form', 'inbound', 'intake', new.id::text,
      v_type, v_value, v_name,
      coalesce(nullif(new.form_title_snapshot, ''), 'Support form submission'),
      v_body,
      jsonb_build_object('submission_id', new.id, 'form_id', new.form_id, 'category', new.category_title_snapshot),
      'intake:' || new.id::text,
      null, v_category, v_extra,
      new.submitted_at
    );
  exception when others then
    raise warning 'support_intake_to_ticket failed: %', sqlerrm;
  end;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.support_whatsapp_messages') is not null
     and to_regclass('public.support_whatsapp_conversations') is not null then
    drop trigger if exists support_wa_message_to_ticket_trg on public.support_whatsapp_messages;
    create trigger support_wa_message_to_ticket_trg
      after insert on public.support_whatsapp_messages
      for each row execute function public.support_wa_message_to_ticket();
  end if;

  if to_regclass('public.intake_submissions') is not null then
    drop trigger if exists support_intake_to_ticket_trg on public.intake_submissions;
    create trigger support_intake_to_ticket_trg
      after insert on public.intake_submissions
      for each row execute function public.support_intake_to_ticket();
  end if;
end $$;

revoke all on function public.support_wa_message_to_ticket() from public, anon, authenticated;
revoke all on function public.support_intake_to_ticket() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Realtime: the Command Centre updates itself instead of being refreshed.
--    Realtime honours the SELECT policies, so only Support staff receive rows.
-- ---------------------------------------------------------------------------

do $$
declare n text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach n in array array[
      'support_tickets','support_interactions','support_ticket_notes',
      'support_agent_presence','support_calls','support_callbacks'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = n
      ) then
        execute format('alter publication supabase_realtime add table public.%I', n);
      end if;
    end loop;
  end if;
end $$;

commit;

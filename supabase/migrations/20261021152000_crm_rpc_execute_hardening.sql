begin;

-- Remove anonymous/public execution from all CRM functions.
revoke all on function public.crm_is_member(uuid) from public, anon;
revoke all on function public.crm_role_of(uuid) from public, anon;
revoke all on function public.crm_is_supervisor(uuid) from public, anon;
revoke all on function public.crm_is_admin(uuid) from public, anon;
revoke all on function public.crm_can_access_ticket(uuid,uuid) from public, anon;
revoke all on function public.crm_touch_updated_at() from public, anon;

revoke all on function public.crm_create_driver_ticket(text,text,text,text,text,uuid,uuid) from public, anon;
revoke all on function public.crm_create_driver_ticket_v2(text,text,text,text,text,text,integer,text,text,text,uuid,uuid) from public, anon;
revoke all on function public.crm_add_note(uuid,text) from public, anon;
revoke all on function public.crm_create_followup(uuid,text,timestamptz,uuid) from public, anon;
revoke all on function public.crm_complete_followup(uuid) from public, anon;
revoke all on function public.crm_update_driver_status(uuid,uuid) from public, anon;
revoke all on function public.crm_reassign_ticket(uuid,uuid) from public, anon;
revoke all on function public.crm_upsert_status(uuid,text,text,text,boolean,boolean,boolean,integer) from public, anon;
revoke all on function public.crm_update_ticket_state(uuid,public.crm_ticket_state) from public, anon;
revoke all on function public.crm_update_driver_contact(uuid,text,text,text,text,text,text,integer,text,text,text) from public, anon;
revoke all on function public.crm_upsert_member(uuid,text,public.crm_role,boolean,text,text,text) from public, anon;
revoke all on function public.crm_set_availability(text) from public, anon;
revoke all on function public.crm_set_call_disposition(uuid,text,text) from public, anon;

-- Explicit authenticated permissions.
grant execute on function public.crm_is_member(uuid) to authenticated;
grant execute on function public.crm_role_of(uuid) to authenticated;
grant execute on function public.crm_is_supervisor(uuid) to authenticated;
grant execute on function public.crm_is_admin(uuid) to authenticated;
grant execute on function public.crm_can_access_ticket(uuid,uuid) to authenticated;

grant execute on function public.crm_create_driver_ticket(text,text,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.crm_create_driver_ticket_v2(text,text,text,text,text,text,integer,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.crm_add_note(uuid,text) to authenticated;
grant execute on function public.crm_create_followup(uuid,text,timestamptz,uuid) to authenticated;
grant execute on function public.crm_complete_followup(uuid) to authenticated;
grant execute on function public.crm_update_driver_status(uuid,uuid) to authenticated;
grant execute on function public.crm_reassign_ticket(uuid,uuid) to authenticated;
grant execute on function public.crm_upsert_status(uuid,text,text,text,boolean,boolean,boolean,integer) to authenticated;
grant execute on function public.crm_update_ticket_state(uuid,public.crm_ticket_state) to authenticated;
grant execute on function public.crm_update_driver_contact(uuid,text,text,text,text,text,text,integer,text,text,text) to authenticated;
grant execute on function public.crm_upsert_member(uuid,text,public.crm_role,boolean,text,text,text) to authenticated;
grant execute on function public.crm_set_availability(text) to authenticated;
grant execute on function public.crm_set_call_disposition(uuid,text,text) to authenticated;

commit;

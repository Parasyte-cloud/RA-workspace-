-- Support read-model views intentionally execute with owner rights.
--
-- They expose a narrow projection to authenticated Support users while
-- avoiding direct browser grants on underlying Support/employee tables.
--
-- Each view must retain its explicit support_is_staff(auth.uid()) or
-- support_is_supervisor(auth.uid()) predicate.
--
-- security_barrier prevents planner optimisations from pushing caller
-- predicates through the protected view boundary.

alter view public.support_active_calls_view
  set (security_barrier = true);

alter view public.support_agent_presence_view
  set (security_barrier = true);

alter view public.support_callbacks_view
  set (security_barrier = true);

alter view public.support_channel_stats_view
  set (security_barrier = true);

alter view public.support_incident_board_view
  set (security_barrier = true);

alter view public.support_kpi_today_view
  set (security_barrier = true);

alter view public.support_queue_snapshot_view
  set (security_barrier = true);

alter view public.support_telephony_health_view
  set (security_barrier = true);

alter view public.support_ticket_summary_view
  set (security_barrier = true);

revoke all on public.support_active_calls_view from anon, public;
revoke all on public.support_agent_presence_view from anon, public;
revoke all on public.support_callbacks_view from anon, public;
revoke all on public.support_channel_stats_view from anon, public;
revoke all on public.support_incident_board_view from anon, public;
revoke all on public.support_kpi_today_view from anon, public;
revoke all on public.support_queue_snapshot_view from anon, public;
revoke all on public.support_telephony_health_view from anon, public;
revoke all on public.support_ticket_summary_view from anon, public;

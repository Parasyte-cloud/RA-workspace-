-- One row per unapplied-looking migration. applied = true means its effect is in production.
select * from (values
 ('20260906171000_reusable_intake_platform', to_regclass('public.intake_forms') is not null),
 ('20260907095000_intake_rate_limits',        to_regclass('public.intake_rate_limits') is not null),
 ('20260907114500_intake_assignment_route_hardening', to_regprocedure('public.can_access_intake_route(uuid)') is not null or exists(select 1 from pg_proc where proname='intake_employee_can_receive_route')),
 ('20260907122000_intake_assignment_candidates', exists(select 1 from pg_proc where proname='list_intake_assignment_candidates')),
 ('20260918120000_per_workstation_guides', exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname ilike '%guide%')),
 ('20260920090000_employee_hr_details', to_regclass('public.employee_hr_details') is not null),
 ('20260923090000_intake_submission_notifications', exists(select 1 from pg_proc where proname='notify_intake_submission_routed')),
 ('20260923110000_ridearrivo_booking_notifications', to_regclass('public.ridearrivo_ride_notifications') is not null),
 ('20260923120000_public_site_forms', exists(select 1 from public.intake_forms where slug='contact-us')),
 ('20260923220000_charter_booking_v2', exists(select 1 from public.intake_forms where slug='charter-booking')),
 ('20260924110000_membership_signup_form', exists(select 1 from public.intake_forms where slug='membership-signup')),
 ('20260924130000_move_booking_form', exists(select 1 from public.intake_forms where slug='move-booking')),
 ('20260926230000_room7_participant_removal', exists(select 1 from information_schema.columns where table_schema='public' and table_name='workspace_room_participants' and column_name='removed_at'))
) as t(migration, applied)
order by migration;

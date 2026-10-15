-- Audit 2026-10-15, finding 4.
-- "manager" is a company-wide role, not a reporting line, so every manager could
-- read recruitment candidates, performance reviews and training records for the
-- whole company, and privacy-rights requests and regulatory filings.
--   People tables  : hr and admin only.
--   Legal tables   : legal and admin only (read and write).
-- Executive tables are deliberately left alone: the executive workstation is
-- for manager and admin by design. Support and operations keep manager access.
do $$
declare t text;
begin
  foreach t in array array['people_candidates','people_performance_reviews','people_training_records'] loop
    execute format('drop policy if exists "people os read" on public.%I', t);
    execute format('drop policy if exists "people os write" on public.%I', t);
    execute format('create policy "people os read" on public.%I for select to authenticated using (public.has_workspace_role(array[''hr'',''admin'']))', t);
    execute format('create policy "people os write" on public.%I for all to authenticated using (public.has_workspace_role(array[''hr'',''admin''])) with check (public.has_workspace_role(array[''hr'',''admin'']))', t);
  end loop;

  foreach t in array array['legal_requests','privacy_requests','regulatory_filings'] loop
    execute format('drop policy if exists "legal os read" on public.%I', t);
    execute format('create policy "legal os read" on public.%I for select to authenticated using (public.has_workspace_role(array[''legal'',''admin'']))', t);
  end loop;
end $$;

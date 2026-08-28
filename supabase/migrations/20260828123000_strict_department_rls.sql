-- ============================================================
-- RideArrivo strict departmental RLS
--
-- Principle:
--   Department operational data belongs to that department.
--   Manager and Admin retain company-wide read access.
--   Admin retains company-wide write access.
--
-- Shared/self-service tables are intentionally not changed here.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- CRM
-- No dedicated CRM role currently exists.
-- Until one is introduced, CRM is management-only.
-- ------------------------------------------------------------

drop policy if exists "crm read"
on public.crm_accounts;

drop policy if exists "crm write"
on public.crm_accounts;

create policy "crm read"
on public.crm_accounts
for select
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
);

create policy "crm write"
on public.crm_accounts
for all
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
)
with check (
  public.has_workspace_role(
    array['manager','admin']
  )
);


drop policy if exists "crm contacts read"
on public.crm_contacts;

drop policy if exists "crm contacts write"
on public.crm_contacts;

create policy "crm contacts read"
on public.crm_contacts
for select
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
);

create policy "crm contacts write"
on public.crm_contacts
for all
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
)
with check (
  public.has_workspace_role(
    array['manager','admin']
  )
);


drop policy if exists "crm leads read"
on public.crm_leads;

drop policy if exists "crm leads write"
on public.crm_leads;

create policy "crm leads read"
on public.crm_leads
for select
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
);

create policy "crm leads write"
on public.crm_leads
for all
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
)
with check (
  public.has_workspace_role(
    array['manager','admin']
  )
);


drop policy if exists "crm opp read"
on public.crm_opportunities;

drop policy if exists "crm opp write"
on public.crm_opportunities;

create policy "crm opp read"
on public.crm_opportunities
for select
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
);

create policy "crm opp write"
on public.crm_opportunities
for all
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
)
with check (
  public.has_workspace_role(
    array['manager','admin']
  )
);


drop policy if exists "crm activity read"
on public.crm_activities;

drop policy if exists "crm activity write"
on public.crm_activities;

create policy "crm activity read"
on public.crm_activities
for select
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
);

create policy "crm activity write"
on public.crm_activities
for all
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
)
with check (
  public.has_workspace_role(
    array['manager','admin']
  )
);

-- ------------------------------------------------------------
-- SUPPORT
-- ------------------------------------------------------------

drop policy if exists "support read"
on public.support_cases;

drop policy if exists "support write"
on public.support_cases;

create policy "support read"
on public.support_cases
for select
to authenticated
using (
  public.has_workspace_role(
    array['support','manager','admin']
  )
);

create policy "support write"
on public.support_cases
for all
to authenticated
using (
  public.has_workspace_role(
    array['support','admin']
  )
)
with check (
  public.has_workspace_role(
    array['support','admin']
  )
);

-- ------------------------------------------------------------
-- INCIDENTS
--
-- Ownership is currently operationally ambiguous between
-- Support / Operations / Legal, so use management-only rather
-- than silently sharing incident records across departments.
-- We can introduce scoped incident sharing later.
-- ------------------------------------------------------------

drop policy if exists "incident read"
on public.incidents;

drop policy if exists "incident write"
on public.incidents;

create policy "incident read"
on public.incidents
for select
to authenticated
using (
  public.has_workspace_role(
    array['manager','admin']
  )
);

create policy "incident write"
on public.incidents
for all
to authenticated
using (
  public.has_workspace_role(
    array['admin']
  )
)
with check (
  public.has_workspace_role(
    array['admin']
  )
);

-- ------------------------------------------------------------
-- LEGAL
-- ------------------------------------------------------------

drop policy if exists "legal read"
on public.legal_contracts;

drop policy if exists "legal manage"
on public.legal_contracts;

create policy "legal read"
on public.legal_contracts
for select
to authenticated
using (
  public.has_workspace_role(
    array['legal','manager','admin']
  )
);

create policy "legal manage"
on public.legal_contracts
for all
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
)
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);

-- Compliance becomes Legal-owned.
drop policy if exists "compliance read"
on public.compliance_items;

drop policy if exists "compliance manage"
on public.compliance_items;

create policy "compliance read"
on public.compliance_items
for select
to authenticated
using (
  public.has_workspace_role(
    array['legal','manager','admin']
  )
);

create policy "compliance manage"
on public.compliance_items
for all
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
)
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);

-- ------------------------------------------------------------
-- FINANCE
-- Existing finance model is already correctly isolated:
-- Finance + Manager/Admin read, Finance/Admin write.
-- Reinforce Providus tables explicitly.
-- ------------------------------------------------------------

drop policy if exists "finance bank import read"
on public.finance_bank_imports;

drop policy if exists "finance bank import write"
on public.finance_bank_imports;

create policy "finance bank import read"
on public.finance_bank_imports
for select
to authenticated
using (
  public.has_workspace_role(
    array['finance','manager','admin']
  )
);

create policy "finance bank import write"
on public.finance_bank_imports
for all
to authenticated
using (
  public.has_workspace_role(
    array['finance','admin']
  )
)
with check (
  public.has_workspace_role(
    array['finance','admin']
  )
);


drop policy if exists "finance bank transaction read"
on public.finance_bank_transactions;

drop policy if exists "finance bank transaction write"
on public.finance_bank_transactions;

create policy "finance bank transaction read"
on public.finance_bank_transactions
for select
to authenticated
using (
  public.has_workspace_role(
    array['finance','manager','admin']
  )
);

create policy "finance bank transaction write"
on public.finance_bank_transactions
for all
to authenticated
using (
  public.has_workspace_role(
    array['finance','admin']
  )
)
with check (
  public.has_workspace_role(
    array['finance','admin']
  )
);

-- ------------------------------------------------------------
-- MARKETING
--
-- Remove Partnership visibility.
-- ------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'marketing_campaigns',
    'marketing_content',
    'marketing_assets',
    'marketing_metrics'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'drop policy if exists "marketing read" on public.%I',
        t
      );

      execute format(
        'drop policy if exists "marketing write" on public.%I',
        t
      );

      execute format(
        'create policy "marketing read"
         on public.%I
         for select
         to authenticated
         using (
           public.has_workspace_role(
             array[''marketing'',''manager'',''admin'']
           )
         )',
        t
      );

      execute format(
        'create policy "marketing write"
         on public.%I
         for all
         to authenticated
         using (
           public.has_workspace_role(
             array[''marketing'',''admin'']
           )
         )
         with check (
           public.has_workspace_role(
             array[''marketing'',''admin'']
           )
         )',
        t
      );
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------
-- PARTNERSHIPS
--
-- Remove Marketing / Operations / Finance / Legal visibility.
-- ------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'partnership_accounts',
    'partnership_contacts',
    'partnership_opportunities',
    'partnership_activities'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'drop policy if exists "partnership read" on public.%I',
        t
      );

      execute format(
        'drop policy if exists "partnership write" on public.%I',
        t
      );

      execute format(
        'create policy "partnership read"
         on public.%I
         for select
         to authenticated
         using (
           public.has_workspace_role(
             array[''partnerships'',''manager'',''admin'']
           )
         )',
        t
      );

      execute format(
        'create policy "partnership write"
         on public.%I
         for all
         to authenticated
         using (
           public.has_workspace_role(
             array[''partnerships'',''admin'']
           )
         )
         with check (
           public.has_workspace_role(
             array[''partnerships'',''admin'']
           )
         )',
        t
      );
    end if;
  end loop;
end
$$;

commit;

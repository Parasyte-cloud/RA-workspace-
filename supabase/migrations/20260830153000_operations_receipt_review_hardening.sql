begin;

create or replace function public.enforce_operations_receipt_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_workspace_role();

  v_evidence_changed boolean;
  v_metadata_changed boolean;
begin
  if v_actor is null then
    raise exception
      'Authentication is required for receipt changes';
  end if;


  -- ==========================================================
  -- INSERT
  -- ==========================================================

  if TG_OP = 'INSERT' then
    if v_role not in (
      'operations',
      'finance',
      'admin'
    ) then
      raise exception
        'Operations, Finance or administrator access is required';
    end if;

    -- Server-controlled submission identity.
    new.submitted_by := v_actor;
    new.submitted_at := now();

    new.status := 'submitted';

    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;

    new.voided_by := null;
    new.voided_at := null;
    new.void_reason := null;

    return new;
  end if;


  -- ==========================================================
  -- CHANGE DETECTION
  -- ==========================================================

  v_evidence_changed :=
       new.receipt_type is distinct from old.receipt_type
    or new.storage_path is distinct from old.storage_path
    or new.original_filename is distinct from old.original_filename
    or new.mime_type is distinct from old.mime_type
    or new.file_size is distinct from old.file_size;


  v_metadata_changed :=
       new.vendor_name is distinct from old.vendor_name
    or new.receipt_date is distinct from old.receipt_date
    or new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.expense_category is distinct from old.expense_category
    or new.description is distinct from old.description
    or new.booking_reference is distinct from old.booking_reference
    or new.vehicle_reference is distinct from old.vehicle_reference
    or new.trip_reference is distinct from old.trip_reference;


  -- ==========================================================
  -- ORIGINAL EVIDENCE IS IMMUTABLE
  -- ==========================================================

  if v_evidence_changed then
    raise exception
      'Receipt evidence is immutable. Void the receipt and submit a new record instead';
  end if;


  -- ==========================================================
  -- FINAL RECORDS ARE IMMUTABLE
  -- ==========================================================

  if old.status in (
    'approved',
    'rejected',
    'voided'
  ) then
    raise exception
      'Finalised receipt records cannot be modified';
  end if;


  -- ==========================================================
  -- OPERATIONS
  -- ==========================================================

  if v_role = 'operations' then
    if old.submitted_by <> v_actor then
      raise exception
        'Operations users may only modify receipts they submitted';
    end if;

    if old.status <> 'submitted' then
      raise exception
        'Receipt metadata can only be corrected before Finance review';
    end if;

    if new.status <> old.status then
      raise exception
        'Operations users cannot change receipt review status';
    end if;

    -- Preserve every workflow-controlled value.
    new.submitted_by := old.submitted_by;
    new.submitted_at := old.submitted_at;

    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;

    new.voided_by := old.voided_by;
    new.voided_at := old.voided_at;
    new.void_reason := old.void_reason;

    return new;
  end if;


  -- ==========================================================
  -- FINANCE / ADMIN
  -- ==========================================================

  if v_role not in (
    'finance',
    'admin'
  ) then
    raise exception
      'Finance or administrator access is required';
  end if;


  -- Finance reviews; Finance does not rewrite submissions.
  if v_metadata_changed then
    raise exception
      'Finance reviewers cannot modify submitted receipt metadata';
  end if;


  -- Submission identity can never be spoofed.
  new.submitted_by := old.submitted_by;
  new.submitted_at := old.submitted_at;


  -- Preserve controlled reviewer/void fields unless the
  -- corresponding workflow transition below explicitly sets them.
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;

  new.voided_by := old.voided_by;
  new.voided_at := old.voided_at;


  -- ==========================================================
  -- STATUS TRANSITIONS
  -- ==========================================================

  if new.status is distinct from old.status then

    -- --------------------------------------------------------
    -- SUBMITTED -> UNDER REVIEW
    -- --------------------------------------------------------

    if new.status = 'under_review' then
      if old.status <> 'submitted' then
        raise exception
          'Only submitted receipts can enter review';
      end if;

      if old.submitted_by = v_actor then
        raise exception
          'A receipt submitter cannot review their own receipt';
      end if;

      new.reviewed_by := v_actor;
      new.reviewed_at := now();

      new.void_reason := old.void_reason;


    -- --------------------------------------------------------
    -- UNDER REVIEW -> APPROVED / REJECTED
    -- --------------------------------------------------------

    elsif new.status in (
      'approved',
      'rejected'
    ) then
      if old.status <> 'under_review' then
        raise exception
          'Receipt must be under review before final decision';
      end if;

      if old.submitted_by = v_actor then
        raise exception
          'A receipt submitter cannot approve or reject their own receipt';
      end if;

      if new.status = 'rejected'
         and (
           new.review_note is null
           or trim(new.review_note) = ''
         )
      then
        raise exception
          'A review reason is required when rejecting a receipt';
      end if;

      new.reviewed_by := v_actor;
      new.reviewed_at := now();

      new.void_reason := old.void_reason;


    -- --------------------------------------------------------
    -- VOID
    -- --------------------------------------------------------

    elsif new.status = 'voided' then
      if new.void_reason is null
         or trim(new.void_reason) = ''
      then
        raise exception
          'A reason is required to void a receipt';
      end if;

      new.voided_by := v_actor;
      new.voided_at := now();


    else
      raise exception
        'Invalid receipt workflow transition';

    end if;


  -- ==========================================================
  -- NON-STATUS FINANCE UPDATE
  -- ==========================================================

  else
    if old.status = 'submitted'
       and new.review_note is distinct from old.review_note
    then
      raise exception
        'Start Finance review before adding a review note';
    end if;

    -- Void reason is meaningful only during a void transition.
    new.void_reason := old.void_reason;
  end if;


  return new;
end;
$$;


revoke all
on function public.enforce_operations_receipt_workflow()
from public, anon;


commit;

-- Scoped manual reactivation job generation. The existing no-argument function
-- remains available to trusted scheduled callers, while UI callers use this
-- owner-scoped function through the authenticated Edge Function.
CREATE OR REPLACE FUNCTION public.create_reactivation_jobs_for_owner(_owner_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer := 0;
BEGIN
  IF _owner_id IS NULL THEN
    RAISE EXCEPTION 'owner_id_required';
  END IF;

  WITH stage_rows AS (
    SELECT
      p.id AS owner_id,
      (s.idx - 1)::int AS stage_index,
      (s.stage->>'days')::int AS days,
      COALESCE((s.stage->>'discount_percent')::int, 20) AS discount_percent,
      COALESCE(s.stage->>'label', '') AS label,
      p.approval_mode,
      p.approval_required_templates
    FROM public.profiles p,
    LATERAL jsonb_array_elements(COALESCE(p.reactivation_stages, '[]'::jsonb))
      WITH ORDINALITY AS s(stage, idx)
    WHERE p.id = _owner_id
      AND COALESCE(p.reactivation_enabled, true) = true
      AND jsonb_typeof(p.reactivation_stages) = 'array'
  ),
  inserted AS (
    INSERT INTO public.scheduled_jobs
      (owner_id, location_id, customer_id, job_type, scheduled_for, payload, approval_status)
    SELECT
      c.owner_id,
      c.location_id,
      c.id,
      'reactivation',
      ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
      jsonb_build_object(
        'stage', sr.stage_index + 1,
        'stage_index', sr.stage_index,
        'days_since', (CURRENT_DATE - c.last_visit_date),
        'discount_percent', sr.discount_percent,
        'label', sr.label
      ),
      CASE
        WHEN sr.approval_mode = 'semi_auto' THEN 'pending_approval'::job_approval_status
        WHEN sr.approval_mode = 'per_template'
          AND 'reactivation' = ANY(sr.approval_required_templates)
          THEN 'pending_approval'::job_approval_status
        ELSE 'auto'::job_approval_status
      END
    FROM public.customers c
    JOIN stage_rows sr ON sr.owner_id = c.owner_id
    WHERE c.owner_id = _owner_id
      AND c.last_visit_date BETWEEN
        CURRENT_DATE - (sr.days + 3) * INTERVAL '1 day'
        AND CURRENT_DATE - (sr.days - 3) * INTERVAL '1 day'
      AND COALESCE(c.is_test, false) = false
      AND (c.quiet_until IS NULL OR c.quiet_until <= now())
      AND NOT EXISTS (
        SELECT 1
        FROM public.scheduled_jobs j
        WHERE j.customer_id = c.id
          AND j.job_type = 'reactivation'
          AND COALESCE((j.payload->>'stage_index')::int, (j.payload->>'stage')::int - 1) = sr.stage_index
          AND j.created_at > c.last_visit_date::timestamptz
      )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO _count FROM inserted;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_reactivation_jobs_for_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reactivation_jobs_for_owner(uuid) TO service_role;

-- Prevent future duplicate LINE links even while historical duplicates are
-- reviewed. The advisory lock closes the check/update race without rewriting
-- existing customer rows.
CREATE OR REPLACE FUNCTION public.guard_customer_line_user_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.line_user_id := NULLIF(btrim(COALESCE(NEW.line_user_id, '')), '');
  IF NEW.line_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text || ':' || NEW.line_user_id, 0));
  IF EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.owner_id = NEW.owner_id
      AND c.line_user_id = NEW.line_user_id
      AND c.id <> NEW.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'line_user_id_already_linked_for_owner',
      CONSTRAINT = 'customers_owner_line_user_guard';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_line_user_uniqueness ON public.customers;
CREATE TRIGGER trg_guard_customer_line_user_uniqueness
BEFORE INSERT OR UPDATE OF owner_id, line_user_id ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_line_user_uniqueness();

CREATE INDEX IF NOT EXISTS idx_customers_owner_line_user
  ON public.customers(owner_id, line_user_id)
  WHERE line_user_id IS NOT NULL AND line_user_id <> '';

-- Normalize future contact data. Phone numbers are intentionally not unique:
-- family members can legitimately share one contact number. Historical rows
-- are not rewritten by this migration.
CREATE OR REPLACE FUNCTION public.normalize_customer_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _phone text;
BEGIN
  NEW.full_name := btrim(NEW.full_name);
  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  _phone := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g'), '');
  NEW.phone := _phone;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_and_guard_customer_contact ON public.customers;
DROP TRIGGER IF EXISTS trg_normalize_customer_contact ON public.customers;
CREATE TRIGGER trg_normalize_customer_contact
BEFORE INSERT OR UPDATE OF owner_id, full_name, phone, email ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.normalize_customer_contact();

CREATE INDEX IF NOT EXISTS idx_customers_owner_normalized_phone
  ON public.customers(owner_id, (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')))
  WHERE phone IS NOT NULL AND phone <> '';

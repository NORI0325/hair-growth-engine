-- Phase 1: Send Guard 基盤

-- 1. customers Send Guard
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS first_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quiet_until TIMESTAMPTZ;

UPDATE public.customers
   SET first_imported_at = COALESCE(last_imported_at, created_at)
 WHERE first_imported_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_owner_sbid_uniq
  ON public.customers(owner_id, salonboard_customer_id)
  WHERE salonboard_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_owner_phone_uniq
  ON public.customers(owner_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

-- 2. scheduled_jobs 承認ワークフロー
DO $$ BEGIN
  CREATE TYPE public.job_approval_status AS ENUM ('auto','pending_approval','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS approval_status public.job_approval_status NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_date DATE
    GENERATED ALWAYS AS ((scheduled_for AT TIME ZONE 'Asia/Tokyo')::date) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_dedupe_pending
  ON public.scheduled_jobs(customer_id, job_type, scheduled_date)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS scheduled_jobs_pending_approval_idx
  ON public.scheduled_jobs(owner_id, approval_status)
  WHERE status = 'pending' AND approval_status = 'pending_approval';

DROP POLICY IF EXISTS "manager jobs approve" ON public.scheduled_jobs;
CREATE POLICY "manager jobs approve" ON public.scheduled_jobs
  FOR UPDATE TO authenticated
  USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role))
  WITH CHECK (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

-- 3. profiles Send Guard 設定
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS import_quiet_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (approval_mode IN ('auto','semi_auto','per_template')),
  ADD COLUMN IF NOT EXISTS approval_required_templates TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS frequency_cap_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS frequency_cap_per_month INTEGER NOT NULL DEFAULT 4;

-- 4. last_sent_at ヘルパー
CREATE OR REPLACE FUNCTION public.last_sent_at(_customer_id uuid)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    (SELECT MAX(created_at) FROM public.email_send_log
       WHERE (metadata->>'customer_id')::uuid = _customer_id AND status = 'sent'),
    (SELECT MAX(created_at) FROM public.line_message_log
       WHERE customer_id = _customer_id AND status = 'sent')
  )
$$;

-- 5. 配信履歴ビュー
CREATE OR REPLACE VIEW public.customer_delivery_timeline AS
SELECT
  esl.id::text AS id,
  (esl.metadata->>'owner_id')::uuid AS owner_id,
  (esl.metadata->>'customer_id')::uuid AS customer_id,
  'email'::text AS channel,
  esl.template_name AS template_key,
  esl.status,
  esl.recipient_email AS recipient,
  esl.error_message AS error,
  esl.created_at AS sent_at
FROM public.email_send_log esl
WHERE esl.metadata ? 'customer_id'
UNION ALL
SELECT
  lml.id::text AS id,
  lml.owner_id,
  lml.customer_id,
  'line'::text AS channel,
  COALESCE(lml.template_key, lml.job_type) AS template_key,
  lml.status,
  lml.line_user_id AS recipient,
  lml.error,
  lml.created_at AS sent_at
FROM public.line_message_log lml
WHERE lml.customer_id IS NOT NULL;

GRANT SELECT ON public.customer_delivery_timeline TO authenticated;

-- 6. customers の send guard 自動セット
CREATE OR REPLACE FUNCTION public.set_customer_send_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _quiet_days INTEGER;
BEGIN
  IF NEW.first_imported_at IS NULL THEN
    NEW.first_imported_at := COALESCE(NEW.last_imported_at, now());
  END IF;
  IF NEW.quiet_until IS NULL AND NEW.imported_from IS NOT NULL THEN
    SELECT COALESCE(import_quiet_days, 7) INTO _quiet_days
      FROM public.profiles WHERE id = NEW.owner_id;
    NEW.quiet_until := NEW.first_imported_at + (COALESCE(_quiet_days,7) || ' days')::interval;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_send_guard ON public.customers;
CREATE TRIGGER trg_customers_send_guard
  BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_send_guard();

-- 7. welcome はインポート顧客には作らない
CREATE OR REPLACE FUNCTION public.schedule_welcome_on_customer_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.is_test, false) = true THEN RETURN NEW; END IF;
  IF NEW.imported_from IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  VALUES (
    NEW.owner_id, NEW.id, 'welcome',
    GREATEST(now() + INTERVAL '5 minutes', ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo')),
    jsonb_build_object('source', 'customer_insert')
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 8. reactivation: quiet_until 反映 + 承認モード
CREATE OR REPLACE FUNCTION public.create_reactivation_jobs()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _count INTEGER := 0;
BEGIN
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
    WHERE COALESCE(p.reactivation_enabled, true) = true
      AND jsonb_typeof(p.reactivation_stages) = 'array'
  ),
  inserted AS (
    INSERT INTO public.scheduled_jobs
      (owner_id, customer_id, job_type, scheduled_for, payload, approval_status)
    SELECT
      c.owner_id, c.id, 'reactivation',
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
    WHERE c.last_visit_date BETWEEN
            CURRENT_DATE - (sr.days + 3) * INTERVAL '1 day'
        AND CURRENT_DATE - (sr.days - 3) * INTERVAL '1 day'
      AND COALESCE(c.is_test, false) = false
      AND (c.quiet_until IS NULL OR c.quiet_until <= now())
      AND NOT EXISTS (
        SELECT 1 FROM public.scheduled_jobs j
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

-- 9. birthday: quiet_until + 承認モード
CREATE OR REPLACE FUNCTION public.create_birthday_jobs_for_month()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _count INTEGER := 0;
BEGIN
  INSERT INTO public.scheduled_jobs
    (owner_id, customer_id, job_type, scheduled_for, payload, approval_status)
  SELECT
    c.owner_id, c.id, 'birthday', now(),
    jsonb_build_object(
      'month', EXTRACT(MONTH FROM CURRENT_DATE),
      'discount_percent', COALESCE(p.birthday_discount_percent, 30)
    ),
    CASE
      WHEN p.approval_mode = 'semi_auto' THEN 'pending_approval'::job_approval_status
      WHEN p.approval_mode = 'per_template'
           AND 'birthday' = ANY(p.approval_required_templates)
        THEN 'pending_approval'::job_approval_status
      ELSE 'auto'::job_approval_status
    END
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.birthday IS NOT NULL
    AND COALESCE(p.birthday_enabled, true) = true
    AND EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM CURRENT_DATE)
    AND (c.quiet_until IS NULL OR c.quiet_until <= now())
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id
        AND j.job_type = 'birthday'
        AND date_trunc('month', j.created_at) = date_trunc('month', CURRENT_DATE)
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
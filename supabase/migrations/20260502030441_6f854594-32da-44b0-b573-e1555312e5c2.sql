
-- =========================================================
-- Phase 4: 頻度キャップ用 customer_communication_state
-- =========================================================
CREATE TABLE IF NOT EXISTS public.customer_communication_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  location_id uuid,
  last_sent_at timestamptz,
  last_template_key text,
  last_channel text,
  monthly_count integer NOT NULL DEFAULT 0,
  monthly_period_start date NOT NULL DEFAULT date_trunc('month', now())::date,
  total_sent integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);

ALTER TABLE public.customer_communication_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant ccs read" ON public.customer_communication_state
  FOR SELECT TO authenticated
  USING (is_tenant_member(owner_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_ccs_owner ON public.customer_communication_state(owner_id);
CREATE INDEX IF NOT EXISTS idx_ccs_last_sent ON public.customer_communication_state(last_sent_at DESC);

-- =========================================================
-- Phase 6: 顧客の自動配信オプトアウト
-- =========================================================
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS opt_out_automation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_out_reason text,
  ADD COLUMN IF NOT EXISTS opt_out_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_customers_opt_out ON public.customers(owner_id) WHERE opt_out_automation = true;

-- =========================================================
-- Phase 4: 頻度キャップ判定関数
-- =========================================================
CREATE OR REPLACE FUNCTION public.can_send_to_customer(
  _customer_id uuid,
  _cap_days integer DEFAULT 7,
  _cap_per_month integer DEFAULT 4
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  s record;
  current_month_start date := date_trunc('month', now())::date;
BEGIN
  SELECT id, opt_out_automation, quiet_until INTO c
  FROM customers WHERE id = _customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'customer_not_found');
  END IF;

  IF c.opt_out_automation THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'opted_out');
  END IF;

  IF c.quiet_until IS NOT NULL AND c.quiet_until > now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'quiet_period', 'until', c.quiet_until);
  END IF;

  SELECT last_sent_at, monthly_count, monthly_period_start INTO s
  FROM customer_communication_state WHERE customer_id = _customer_id;

  IF FOUND THEN
    IF s.last_sent_at IS NOT NULL AND s.last_sent_at > now() - (_cap_days || ' days')::interval THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'cooldown',
        'last_sent_at', s.last_sent_at, 'cooldown_days', _cap_days);
    END IF;
    IF s.monthly_period_start = current_month_start AND s.monthly_count >= _cap_per_month THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'monthly_cap_reached',
        'monthly_count', s.monthly_count, 'cap', _cap_per_month);
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true);
END $$;

-- 配信成功時に呼ぶ記録関数
CREATE OR REPLACE FUNCTION public.record_customer_communication(
  _customer_id uuid,
  _owner_id uuid,
  _location_id uuid,
  _template_key text,
  _channel text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_month_start date := date_trunc('month', now())::date;
BEGIN
  INSERT INTO customer_communication_state (
    customer_id, owner_id, location_id,
    last_sent_at, last_template_key, last_channel,
    monthly_count, monthly_period_start, total_sent
  ) VALUES (
    _customer_id, _owner_id, _location_id,
    now(), _template_key, _channel,
    1, current_month_start, 1
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    last_sent_at = now(),
    last_template_key = _template_key,
    last_channel = _channel,
    monthly_count = CASE
      WHEN customer_communication_state.monthly_period_start = current_month_start
        THEN customer_communication_state.monthly_count + 1
      ELSE 1
    END,
    monthly_period_start = current_month_start,
    total_sent = customer_communication_state.total_sent + 1,
    owner_id = _owner_id,
    location_id = COALESCE(_location_id, customer_communication_state.location_id),
    updated_at = now();
END $$;

-- =========================================================
-- Phase 7: A/Bテスト基盤
-- =========================================================
CREATE TABLE IF NOT EXISTS public.ab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  name text NOT NULL,
  template_key text NOT NULL,
  variant_a jsonb NOT NULL,
  variant_b jsonb NOT NULL,
  split_ratio numeric NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant ab_tests all" ON public.ab_tests
  FOR ALL TO authenticated
  USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role))
  WITH CHECK (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE TABLE IF NOT EXISTS public.ab_test_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ab_test_id uuid NOT NULL REFERENCES public.ab_tests(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  variant text NOT NULL CHECK (variant IN ('A', 'B')),
  scheduled_job_id uuid,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  booked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ab_test_id, customer_id)
);

ALTER TABLE public.ab_test_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant ab_assign read" ON public.ab_test_assignments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ab_tests t
    WHERE t.id = ab_test_assignments.ab_test_id
      AND is_tenant_member(t.owner_id, auth.uid())
  ));

CREATE INDEX IF NOT EXISTS idx_abassign_test ON public.ab_test_assignments(ab_test_id);
CREATE INDEX IF NOT EXISTS idx_abassign_customer ON public.ab_test_assignments(customer_id);

-- =========================================================
-- Phase 5: 配信ダッシュボード用ビュー
-- =========================================================

-- 今後配信予定（pending + 未来）
CREATE OR REPLACE VIEW public.delivery_upcoming_view AS
SELECT
  j.id, j.owner_id, j.location_id, j.customer_id, j.job_type,
  j.scheduled_for, j.approval_status, j.payload,
  c.full_name AS customer_name,
  c.email AS customer_email,
  c.phone AS customer_phone,
  c.opt_out_automation
FROM scheduled_jobs j
LEFT JOIN customers c ON c.id = j.customer_id
WHERE j.status = 'pending'
  AND j.scheduled_for >= now() - interval '1 hour';

GRANT SELECT ON public.delivery_upcoming_view TO authenticated;

-- 日次サマリー（直近30日）
CREATE OR REPLACE VIEW public.delivery_daily_summary AS
WITH latest_email AS (
  SELECT DISTINCT ON (message_id) message_id, status, created_at, template_name, metadata
  FROM email_send_log
  WHERE message_id IS NOT NULL
    AND created_at > now() - interval '30 days'
  ORDER BY message_id, created_at DESC
)
SELECT
  date_trunc('day', created_at)::date AS day,
  (metadata->>'owner_id')::uuid AS owner_id,
  template_name,
  count(*) FILTER (WHERE status = 'sent') AS sent_count,
  count(*) FILTER (WHERE status IN ('dlq','failed','bounced')) AS failed_count,
  count(*) FILTER (WHERE status = 'suppressed') AS suppressed_count,
  count(*) AS total_count
FROM latest_email
GROUP BY 1, 2, 3;

GRANT SELECT ON public.delivery_daily_summary TO authenticated;

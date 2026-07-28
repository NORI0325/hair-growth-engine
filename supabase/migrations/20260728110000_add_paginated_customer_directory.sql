-- Server-side customer directory for tenants with more than the PostgREST
-- per-request row limit. Both functions validate the caller's tenant access.
CREATE OR REPLACE FUNCTION public.search_customer_directory_v1(
  _owner_id uuid,
  _location_id uuid,
  _search text DEFAULT '',
  _filter text DEFAULT 'all',
  _sort text DEFAULT 'recent',
  _limit integer DEFAULT 200,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  full_name text,
  name_kana text,
  email text,
  phone text,
  birthday date,
  last_visit_date date,
  visit_count integer,
  total_spent integer,
  line_user_id text,
  line_unfollowed_at timestamptz,
  opt_out_automation boolean,
  notes text,
  gender text,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  _query text := btrim(COALESCE(_search, ''));
  _safe_limit integer := LEAST(GREATEST(COALESCE(_limit, 200), 1), 500);
  _safe_offset integer := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF _owner_id IS NULL OR _location_id IS NULL
     OR NOT public.is_tenant_member(_owner_id, auth.uid()) THEN
    RAISE EXCEPTION 'customer_directory_forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = _location_id AND l.tenant_id = _owner_id
  ) THEN
    RAISE EXCEPTION 'customer_directory_location_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT c.*
      FROM public.customers c
     WHERE c.owner_id = _owner_id
       AND c.location_id = _location_id
       AND (
         _query = ''
         OR c.full_name ILIKE '%' || _query || '%'
         OR COALESCE(c.name_kana, '') ILIKE '%' || _query || '%'
         OR COALESCE(c.email, '') ILIKE '%' || _query || '%'
         OR COALESCE(c.phone, '') ILIKE '%' || _query || '%'
       )
       AND CASE COALESCE(_filter, 'all')
         WHEN 'active' THEN c.last_visit_date >= _today - 90
         WHEN 'at_risk' THEN c.last_visit_date < _today - 90 AND c.last_visit_date >= _today - 180
         WHEN 'dormant' THEN c.last_visit_date < _today - 180
         WHEN 'new' THEN c.last_visit_date IS NULL
         WHEN 'birthday' THEN c.birthday IS NOT NULL AND EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM _today)
         WHEN 'no_line' THEN c.line_user_id IS NULL OR btrim(c.line_user_id) = ''
         WHEN 'vip' THEN COALESCE(c.total_spent, 0) >= 150000 OR COALESCE(c.visit_count, 0) >= 15
         ELSE true
       END
  )
  SELECT
    f.id,
    f.full_name,
    f.name_kana,
    f.email,
    f.phone,
    f.birthday,
    f.last_visit_date,
    COALESCE(f.visit_count, 0),
    COALESCE(f.total_spent, 0),
    f.line_user_id,
    f.line_unfollowed_at,
    f.opt_out_automation,
    f.notes,
    f.gender::text,
    f.created_at,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN _sort = 'spent' THEN COALESCE(f.total_spent, 0) END DESC,
    CASE WHEN _sort = 'visits' THEN COALESCE(f.visit_count, 0) END DESC,
    CASE WHEN _sort = 'name' THEN f.full_name END ASC,
    CASE WHEN _sort = 'recent' THEN f.last_visit_date END DESC NULLS LAST,
    f.created_at DESC,
    f.id
  LIMIT _safe_limit OFFSET _safe_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_directory_summary_v1(
  _owner_id uuid,
  _location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  _result jsonb;
BEGIN
  IF _owner_id IS NULL OR _location_id IS NULL
     OR NOT public.is_tenant_member(_owner_id, auth.uid()) THEN
    RAISE EXCEPTION 'customer_directory_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'all', COUNT(*),
    'active', COUNT(*) FILTER (WHERE c.last_visit_date >= _today - 90),
    'at_risk', COUNT(*) FILTER (WHERE c.last_visit_date < _today - 90 AND c.last_visit_date >= _today - 180),
    'dormant', COUNT(*) FILTER (WHERE c.last_visit_date < _today - 180),
    'new', COUNT(*) FILTER (WHERE c.last_visit_date IS NULL),
    'birthday', COUNT(*) FILTER (WHERE c.birthday IS NOT NULL AND EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM _today)),
    'no_line', COUNT(*) FILTER (WHERE c.line_user_id IS NULL OR btrim(c.line_user_id) = ''),
    'vip', COUNT(*) FILTER (WHERE COALESCE(c.total_spent, 0) >= 150000 OR COALESCE(c.visit_count, 0) >= 15)
  ) INTO _result
  FROM public.customers c
  WHERE c.owner_id = _owner_id
    AND c.location_id = _location_id;

  RETURN COALESCE(_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.search_customer_directory_v1(uuid, uuid, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_directory_summary_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_customer_directory_v1(uuid, uuid, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_directory_summary_v1(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_customer_insights_v1(
  _owner_id uuid,
  _location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _month integer := EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Tokyo'))::integer;
  _result jsonb;
BEGIN
  IF _owner_id IS NULL OR _location_id IS NULL
     OR NOT public.is_tenant_member(_owner_id, auth.uid()) THEN
    RAISE EXCEPTION 'dashboard_customer_insights_forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = _location_id AND l.tenant_id = _owner_id
  ) THEN
    RAISE EXCEPTION 'dashboard_customer_insights_location_invalid' USING ERRCODE = '22023';
  END IF;

  WITH scoped AS (
    SELECT c.id, c.full_name, c.birthday,
           COALESCE(c.visit_count, 0) AS visit_count,
           COALESCE(c.total_spent, 0) AS total_spent
      FROM public.customers c
     WHERE c.owner_id = _owner_id
       AND c.location_id = _location_id
       AND COALESCE(c.is_test, false) = false
  ), tiered AS (
    SELECT s.*,
      CASE
        WHEN s.total_spent >= 300000 OR s.visit_count >= 30 THEN 'platinum'
        WHEN s.total_spent >= 150000 OR s.visit_count >= 15 THEN 'gold'
        WHEN s.total_spent >= 50000 OR s.visit_count >= 5 THEN 'silver'
        ELSE 'bronze'
      END AS tier
    FROM scoped s
  )
  SELECT jsonb_build_object(
    'total_customers', COUNT(*),
    'vip_distribution', jsonb_build_object(
      'platinum', COUNT(*) FILTER (WHERE t.tier = 'platinum'),
      'gold', COUNT(*) FILTER (WHERE t.tier = 'gold'),
      'silver', COUNT(*) FILTER (WHERE t.tier = 'silver'),
      'bronze', COUNT(*) FILTER (WHERE t.tier = 'bronze')
    ),
    'birthdays', COALESCE(
      jsonb_agg(
        jsonb_build_object('id', t.id, 'full_name', t.full_name, 'birthday', t.birthday)
        ORDER BY EXTRACT(DAY FROM t.birthday), t.full_name
      ) FILTER (WHERE t.birthday IS NOT NULL AND EXTRACT(MONTH FROM t.birthday) = _month),
      '[]'::jsonb
    )
  ) INTO _result
  FROM tiered t;

  RETURN COALESCE(_result, jsonb_build_object(
    'total_customers', 0,
    'vip_distribution', jsonb_build_object('platinum', 0, 'gold', 0, 'silver', 0, 'bronze', 0),
    'birthdays', '[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_customer_insights_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_customer_insights_v1(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.churn_risk_customers_v1(
  _owner_id uuid,
  _location_id uuid,
  _limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  full_name text,
  last_visit_date date,
  visit_count integer,
  total_spent numeric,
  days_since integer,
  is_vip boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF _owner_id IS NULL OR _location_id IS NULL
     OR NOT public.is_tenant_member(_owner_id, auth.uid()) THEN
    RAISE EXCEPTION 'churn_risk_forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.full_name,
    c.last_visit_date,
    COALESCE(c.visit_count, 0),
    COALESCE(c.total_spent, 0),
    (_today - c.last_visit_date)::integer,
    (COALESCE(c.total_spent, 0) >= 150000 OR COALESCE(c.visit_count, 0) >= 15)
  FROM public.customers c
  WHERE c.owner_id = _owner_id
    AND c.location_id = _location_id
    AND COALESCE(c.is_test, false) = false
    AND COALESCE(c.opt_out_automation, false) = false
    AND COALESCE(c.visit_count, 0) >= 2
    AND c.last_visit_date BETWEEN _today - 365 AND _today - 90
  ORDER BY
    (COALESCE(c.total_spent, 0) >= 150000 OR COALESCE(c.visit_count, 0) >= 15) DESC,
    COALESCE(c.total_spent, 0) DESC,
    c.last_visit_date DESC,
    c.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 50);
END;
$$;

CREATE OR REPLACE FUNCTION public.retention_metrics_v1(
  _owner_id uuid,
  _location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  _result jsonb;
BEGIN
  IF _owner_id IS NULL OR _location_id IS NULL
     OR NOT public.is_tenant_member(_owner_id, auth.uid()) THEN
    RAISE EXCEPTION 'retention_metrics_forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = _location_id AND l.tenant_id = _owner_id
  ) THEN
    RAISE EXCEPTION 'retention_metrics_location_invalid' USING ERRCODE = '22023';
  END IF;

  WITH ordered AS (
    SELECT
      b.customer_id,
      b.staff_id,
      b.booking_date,
      b.booking_time,
      row_number() OVER (
        PARTITION BY b.customer_id
        ORDER BY b.booking_date, b.booking_time, b.id
      ) AS visit_number
    FROM public.bookings b
    WHERE b.owner_id = _owner_id
      AND b.location_id = _location_id
      AND b.customer_id IS NOT NULL
      AND b.booking_date >= _today - 365
      AND b.booking_date <= _today
      AND b.status IN ('confirmed', 'completed')
      AND COALESCE(b.is_test, false) = false
  ), customer_stats AS (
    SELECT
      o.customer_id,
      max(o.staff_id::text) FILTER (WHERE o.visit_number = 1)::uuid AS first_staff_id,
      max(o.booking_date) FILTER (WHERE o.visit_number = 1) AS first_date,
      max(o.booking_date) FILTER (WHERE o.visit_number = 2) AS second_date,
      count(*) AS visit_count
    FROM ordered o
    GROUP BY o.customer_id
  ), staff_stats AS (
    SELECT
      s.id AS staff_id,
      s.name,
      count(cs.customer_id) AS total,
      count(cs.customer_id) FILTER (WHERE cs.visit_count >= 2) AS repeated
    FROM public.staff s
    LEFT JOIN customer_stats cs ON cs.first_staff_id = s.id
    WHERE s.owner_id = _owner_id
      AND s.location_id = _location_id
      AND s.active = true
    GROUP BY s.id, s.name
  ), totals AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE cs.visit_count >= 2) AS repeated,
      count(*) FILTER (
        WHERE cs.second_date IS NOT NULL
          AND cs.second_date - cs.first_date BETWEEN 0 AND 90
      ) AS repeated_90
    FROM customer_stats cs
  )
  SELECT jsonb_build_object(
    'overall_second_visit', jsonb_build_object('total', t.total, 'repeated', t.repeated),
    'overall_90_day', jsonb_build_object('total', t.total, 'repeated', t.repeated_90),
    'by_staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id', ss.staff_id,
        'name', ss.name,
        'total', ss.total,
        'repeated', ss.repeated,
        'rate', CASE WHEN ss.total > 0 THEN round(ss.repeated::numeric * 100 / ss.total)::integer ELSE 0 END
      ) ORDER BY
        CASE WHEN ss.total > 0 THEN ss.repeated::numeric / ss.total ELSE 0 END DESC,
        ss.name)
      FROM staff_stats ss
    ), '[]'::jsonb)
  ) INTO _result
  FROM totals t;

  RETURN COALESCE(_result, jsonb_build_object(
    'overall_second_visit', jsonb_build_object('total', 0, 'repeated', 0),
    'overall_90_day', jsonb_build_object('total', 0, 'repeated', 0),
    'by_staff', '[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.churn_risk_customers_v1(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retention_metrics_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.churn_risk_customers_v1(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_metrics_v1(uuid, uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_customers_owner_location_created
  ON public.customers(owner_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_owner_location_last_visit
  ON public.customers(owner_id, location_id, last_visit_date DESC);

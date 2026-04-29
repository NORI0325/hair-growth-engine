
-- 1. profilesに最短予約リードタイム（時間単位）を追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS booking_lead_time_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS booking_max_days_ahead INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS allow_customer_cancel BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancel_deadline_hours INTEGER NOT NULL DEFAULT 3;

-- 2. get_available_slots_by_staff をリードタイム考慮に更新
CREATE OR REPLACE FUNCTION public.get_available_slots_by_staff(
  _salon_slug text,
  _date date,
  _duration_minutes integer,
  _staff_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(slot_time time without time zone, available_staff_ids uuid[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id UUID;
  _open TIME;
  _close TIME;
  _weekday SMALLINT;
  _duration INTERVAL;
  _lead_hours INTEGER;
  _earliest TIMESTAMPTZ;
BEGIN
  IF _duration_minutes IS NULL OR _duration_minutes < 15 THEN
    _duration_minutes := 60;
  END IF;
  _duration := (_duration_minutes || ' minutes')::INTERVAL;
  _weekday := EXTRACT(DOW FROM _date)::SMALLINT;

  SELECT id, COALESCE(open_time, '10:00'::TIME), COALESCE(close_time, '19:00'::TIME),
         COALESCE(booking_lead_time_hours, 24)
    INTO _owner_id, _open, _close, _lead_hours
    FROM public.profiles WHERE public_slug = _salon_slug;

  IF _owner_id IS NULL THEN RETURN; END IF;

  _earliest := now() + (_lead_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH slots AS (
    SELECT (_date + _open + (n || ' minutes')::INTERVAL)::TIMESTAMP AS slot_start
    FROM generate_series(0, EXTRACT(EPOCH FROM (_close - _open))::INTEGER / 60, 15) AS n
    WHERE (_date + _open + (n || ' minutes')::INTERVAL + _duration)::TIME <= _close
      -- リードタイム経過後のみ
      AND (_date + _open + (n || ' minutes')::INTERVAL) AT TIME ZONE 'Asia/Tokyo' >= _earliest
  ),
  active_staff AS (
    SELECT s.id, ss.start_time, ss.end_time
    FROM public.staff s
    JOIN public.staff_schedules ss ON ss.staff_id = s.id
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND ss.weekday = _weekday AND ss.active = true
      AND (_staff_id IS NULL OR s.id = _staff_id)
  ),
  availability AS (
    SELECT
      sl.slot_start::TIME AS t,
      COALESCE(array_agg(a.id) FILTER (
        WHERE
          sl.slot_start::TIME >= a.start_time
          AND (sl.slot_start + _duration)::TIME <= a.end_time
          AND NOT EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.staff_id = a.id
              AND b.booking_date = _date
              AND b.status IN ('pending', 'confirmed')
              AND tsrange(
                (_date + b.booking_time)::TIMESTAMP,
                (_date + b.booking_time + ((COALESCE(b.total_duration_minutes, 60)) || ' minutes')::INTERVAL)::TIMESTAMP
              ) && tsrange(sl.slot_start, sl.slot_start + _duration)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.staff_time_off t
            WHERE t.staff_id = a.id
              AND tstzrange(t.start_at, t.end_at) && tstzrange(
                (sl.slot_start AT TIME ZONE 'Asia/Tokyo'),
                ((sl.slot_start + _duration) AT TIME ZONE 'Asia/Tokyo')
              )
          )
      ), ARRAY[]::uuid[]) AS staff_ids
    FROM slots sl
    LEFT JOIN active_staff a ON true
    GROUP BY sl.slot_start
  )
  SELECT t, staff_ids FROM availability WHERE array_length(staff_ids, 1) > 0 ORDER BY t;
END;
$function$;

-- 3. 顧客向け予約一覧取得RPC（トークンベース）
CREATE OR REPLACE FUNCTION public.get_customer_bookings(_token text)
RETURNS TABLE(
  id uuid,
  booking_date date,
  booking_time time,
  menu text,
  status text,
  staff_name text,
  total_price integer,
  total_duration_minutes integer,
  can_cancel boolean,
  cancel_deadline_hours integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _customer_id UUID;
  _owner_id UUID;
  _allow BOOLEAN;
  _deadline INTEGER;
BEGIN
  SELECT customer_id INTO _customer_id FROM public.booking_tokens WHERE token = _token;
  IF _customer_id IS NULL THEN RETURN; END IF;

  SELECT owner_id INTO _owner_id FROM public.customers WHERE id = _customer_id;
  SELECT COALESCE(allow_customer_cancel, true), COALESCE(cancel_deadline_hours, 3)
    INTO _allow, _deadline
    FROM public.profiles WHERE id = _owner_id;

  RETURN QUERY
  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.menu,
    b.status::text,
    s.name,
    b.total_price,
    b.total_duration_minutes,
    (
      _allow
      AND b.status IN ('pending', 'confirmed')
      AND ((b.booking_date + b.booking_time)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo')
          > now() + (_deadline || ' hours')::INTERVAL
    ) AS can_cancel,
    _deadline
  FROM public.bookings b
  LEFT JOIN public.staff s ON s.id = b.staff_id
  WHERE b.customer_id = _customer_id
    AND b.booking_date >= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY b.booking_date DESC, b.booking_time DESC;
END;
$$;

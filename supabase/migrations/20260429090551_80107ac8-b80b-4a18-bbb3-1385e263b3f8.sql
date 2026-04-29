
-- スタッフ別の空き枠取得
CREATE OR REPLACE FUNCTION public.get_available_slots_by_staff(
  _salon_slug text,
  _date date,
  _duration_minutes integer,
  _staff_id uuid DEFAULT NULL
)
RETURNS TABLE(slot_time time without time zone, available_staff_ids uuid[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _owner_id UUID;
  _open TIME;
  _close TIME;
  _weekday SMALLINT;
  _duration INTERVAL;
BEGIN
  IF _duration_minutes IS NULL OR _duration_minutes < 15 THEN
    _duration_minutes := 60;
  END IF;
  _duration := (_duration_minutes || ' minutes')::INTERVAL;
  _weekday := EXTRACT(DOW FROM _date)::SMALLINT;

  SELECT id, COALESCE(open_time, '10:00'::TIME), COALESCE(close_time, '19:00'::TIME)
    INTO _owner_id, _open, _close
    FROM public.profiles WHERE public_slug = _salon_slug;

  IF _owner_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH slots AS (
    SELECT (_date + _open + (n || ' minutes')::INTERVAL)::TIMESTAMP AS slot_start
    FROM generate_series(0, EXTRACT(EPOCH FROM (_close - _open))::INTEGER / 60, 15) AS n
    WHERE (_date + _open + (n || ' minutes')::INTERVAL + _duration)::TIME <= _close
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
$$;

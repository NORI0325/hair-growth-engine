DROP FUNCTION IF EXISTS public.public_create_booking_v3(text, text, text, text, date, time without time zone, text[], text);

CREATE OR REPLACE FUNCTION public.public_create_booking_v3(
  _salon_slug text,
  _full_name text,
  _phone text,
  _email text,
  _booking_date date,
  _booking_time time without time zone,
  _menus text[],
  _notes text,
  _staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id UUID;
  _location_id UUID;
  _customer_id UUID;
  _booking_id UUID;
  _test_mode BOOLEAN := false;
  _total_duration INTEGER := 0;
  _total_price INTEGER := 0;
  _menu_summary TEXT;
  _resolved_staff_id UUID;
  _weekday SMALLINT;
  _start_ts TIMESTAMP;
  _end_ts TIMESTAMP;
  _start_iso TEXT;
  _end_iso TEXT;
  _ci_record RECORD;
  _ext_staff_name TEXT;
  _ext_staff_id TEXT;
  _ext_menu_name TEXT;
  _external_menu_id TEXT;
  _salonboard_setmenu_id TEXT;
  _menu_rsv_term INTEGER;
  _menu_id UUID;
  _staff_name TEXT;
  _cust_name TEXT;
  _cust_phone TEXT;
  _cust_email TEXT;
BEGIN
  IF _full_name IS NULL OR length(trim(_full_name)) < 1 OR length(_full_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name');
  END IF;
  IF _phone IS NULL OR length(trim(_phone)) < 8 OR length(_phone) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone');
  END IF;
  IF _booking_date IS NULL OR _booking_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_date');
  END IF;
  IF _menus IS NULL OR array_length(_menus, 1) IS NULL OR array_length(_menus, 1) > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_menu');
  END IF;

  SELECT l.tenant_id, l.id INTO _owner_id, _location_id
    FROM public.locations l
    WHERE l.public_slug = _salon_slug
    LIMIT 1;

  IF _owner_id IS NULL THEN
    SELECT id, COALESCE(test_mode, false) INTO _owner_id, _test_mode
      FROM public.profiles WHERE public_slug = _salon_slug;
  ELSE
    SELECT COALESCE(test_mode, false) INTO _test_mode
      FROM public.profiles WHERE id = _owner_id;
  END IF;

  IF _owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'salon_not_found');
  END IF;

  SELECT COALESCE(SUM(duration_minutes + buffer_minutes), 60), COALESCE(SUM(price), 0)
    INTO _total_duration, _total_price
    FROM public.menu_items
   WHERE owner_id = _owner_id
     AND name = ANY(_menus)
     AND active = true
     AND (_location_id IS NULL OR location_id = _location_id OR location_id IS NULL);

  _menu_summary := array_to_string(_menus, ' + ');
  _weekday := EXTRACT(DOW FROM _booking_date)::SMALLINT;
  _start_ts := (_booking_date + _booking_time)::TIMESTAMP;
  _end_ts := _start_ts + (_total_duration || ' minutes')::INTERVAL;
  _start_iso := _start_ts::TIMESTAMP WITH TIME ZONE AT TIME ZONE 'UTC';
  _end_iso := _end_ts::TIMESTAMP WITH TIME ZONE AT TIME ZONE 'UTC';

  IF _staff_id IS NOT NULL THEN
    SELECT s.id INTO _resolved_staff_id
      FROM public.staff s
     WHERE s.id = _staff_id
       AND s.owner_id = _owner_id
       AND s.active = true
       AND s.bookable = true
       AND (_location_id IS NULL OR s.location_id = _location_id)
     LIMIT 1;

    IF _resolved_staff_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_staff');
    END IF;
  ELSE
    SELECT s.id INTO _resolved_staff_id
    FROM public.staff s
    JOIN public.staff_schedules ss
      ON ss.staff_id = s.id AND ss.weekday = _weekday AND ss.active = true
    WHERE s.owner_id = _owner_id AND s.active = true AND s.bookable = true
      AND (_location_id IS NULL OR s.location_id = _location_id)
      AND _booking_time >= ss.start_time
      AND _end_ts::TIME <= ss.end_time
      AND NOT EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.staff_id = s.id
          AND b.booking_date = _booking_date
          AND b.status IN ('pending','confirmed')
          AND tsrange(
            (_booking_date + b.booking_time)::TIMESTAMP,
            (_booking_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
          ) && tsrange(_start_ts, _end_ts)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off t
        WHERE t.staff_id = s.id
          AND tstzrange(t.start_at, t.end_at) && tstzrange(
            (_start_ts AT TIME ZONE 'Asia/Tokyo'),
            (_end_ts AT TIME ZONE 'Asia/Tokyo')
          )
      )
    ORDER BY (
      SELECT COUNT(*) FROM public.bookings b2
      WHERE b2.staff_id = s.id AND b2.booking_date = _booking_date
        AND b2.status IN ('pending','confirmed')
    ) ASC, s.sort_order ASC
    LIMIT 1;
  END IF;

  SELECT id INTO _customer_id
  FROM public.customers
  WHERE owner_id = _owner_id AND phone = _phone
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO public.customers (owner_id, location_id, full_name, phone, email, is_test)
    VALUES (_owner_id, _location_id, trim(_full_name), trim(_phone), NULLIF(trim(_email), ''), _test_mode)
    RETURNING id INTO _customer_id;
  END IF;

  INSERT INTO public.bookings (
    owner_id, location_id, customer_id, booking_date, booking_time,
    menu, menus, total_duration_minutes, total_price,
    notes, status, is_test, staff_id,
    source_channel, external_source
  )
  VALUES (
    _owner_id, _location_id, _customer_id, _booking_date, _booking_time,
    left(_menu_summary, 200), _menus, _total_duration, _total_price,
    NULLIF(trim(_notes), ''), 'pending', _test_mode, _resolved_staff_id,
    'line', 'public_form'
  )
  RETURNING id INTO _booking_id;

  FOR _ci_record IN
    SELECT channel FROM public.channel_integrations
    WHERE owner_id = _owner_id
      AND enabled = true
      AND sync_enabled = true
      AND connection_status = 'live'
      AND (_location_id IS NULL OR location_id = _location_id)
  LOOP
    CONTINUE WHEN _ci_record.channel = 'own_web';

    SELECT full_name, phone, email
    INTO _cust_name, _cust_phone, _cust_email
    FROM public.customers WHERE id = _customer_id;

    SELECT name INTO _staff_name FROM public.staff WHERE id = _resolved_staff_id;

    IF _resolved_staff_id IS NULL THEN
      _staff_name := NULL;
      _ext_staff_name := '指名なし / フリー';
      _ext_staff_id := '0000000000';
    ELSE
      SELECT external_name, external_id
      INTO _ext_staff_name, _ext_staff_id
      FROM public.staff_channel_mappings
      WHERE staff_id = _resolved_staff_id
        AND channel = _ci_record.channel
        AND enabled = true
      LIMIT 1;

      IF _ext_staff_id IS NULL AND (_staff_name ~ 'フリー|指名なし|指名無し') THEN
        _ext_staff_name := COALESCE(_ext_staff_name, '指名なし / フリー');
        _ext_staff_id := '0000000000';
      END IF;
    END IF;

    SELECT id INTO _menu_id FROM public.menu_items
    WHERE owner_id = _owner_id
      AND name = _menus[1]
      AND active = true
      AND (_location_id IS NULL OR location_id = _location_id OR location_id IS NULL)
    ORDER BY CASE WHEN location_id = _location_id THEN 0 ELSE 1 END
    LIMIT 1;

    SELECT external_name, external_id, external_setmenu_id, rsv_term
    INTO _ext_menu_name, _external_menu_id, _salonboard_setmenu_id, _menu_rsv_term
    FROM public.menu_channel_mappings
    WHERE menu_id = _menu_id
      AND channel = _ci_record.channel
      AND enabled = true
    LIMIT 1;

    INSERT INTO public.sync_jobs (
      owner_id, location_id, reservation_id, target_channel, job_type, status, request_payload
    )
    VALUES (
      _owner_id, _location_id, _booking_id, _ci_record.channel, 'create_reservation', 'pending',
      jsonb_build_object(
        'customer_name', _cust_name,
        'customer_kana', '',
        'customer_phone', _cust_phone,
        'customer_email', _cust_email,
        'phone', _cust_phone,
        'date', to_char(_booking_date, 'YYYYMMDD'),
        'time', to_char(_booking_time, 'HH24MI'),
        'rsvTerm', COALESCE(_menu_rsv_term, _total_duration),
        'start_time', _start_iso,
        'end_time', _end_iso,
        'location_id', _location_id,
        'staff_id', _resolved_staff_id,
        'staff_name', _staff_name,
        'external_staff_name', _ext_staff_name,
        'external_staff_id', COALESCE(_ext_staff_id, '0000000000'),
        'stylistId', COALESCE(_ext_staff_id, '0000000000'),
        'menu_id', _menu_id,
        'menu_name', _menu_summary,
        'external_menu_name', _ext_menu_name,
        'external_menu_id', COALESCE(_salonboard_setmenu_id, _external_menu_id),
        'salonboard_setmenu_id', COALESCE(_salonboard_setmenu_id, _external_menu_id),
        'setmenuId', COALESCE(_salonboard_setmenu_id, _external_menu_id),
        'notes', NULLIF(trim(_notes), ''),
        'source_channel', 'line'
      )
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.sync_jobs WHERE reservation_id = _booking_id) THEN
    UPDATE public.bookings SET sync_status = 'pending' WHERE id = _booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', _booking_id,
    'location_id', _location_id,
    'staff_assigned', _resolved_staff_id IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_available_slots_by_staff(_salon_slug text, _date date, _duration_minutes integer, _staff_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(slot_time time without time zone, available_staff_ids uuid[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id UUID;
  _location_id UUID;
  _open TIME;
  _close TIME;
  _closed BOOLEAN;
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

  IF _date < CURRENT_DATE THEN RETURN; END IF;

  SELECT l.tenant_id, l.id, COALESCE(l.open_time, p.open_time, '10:00'::TIME), COALESCE(l.close_time, p.close_time, '19:00'::TIME), COALESCE(p.booking_lead_time_hours, 24)
    INTO _owner_id, _location_id, _open, _close, _lead_hours
    FROM public.locations l
    JOIN public.profiles p ON p.id = l.tenant_id
   WHERE l.public_slug = _salon_slug
   LIMIT 1;

  IF _owner_id IS NULL THEN
    SELECT p.id, NULL::uuid, COALESCE(p.open_time, '10:00'::TIME), COALESCE(p.close_time, '19:00'::TIME), COALESCE(p.booking_lead_time_hours, 24)
      INTO _owner_id, _location_id, _open, _close, _lead_hours
      FROM public.profiles p WHERE p.public_slug = _salon_slug
      LIMIT 1;
  END IF;

  IF _owner_id IS NULL THEN RETURN; END IF;

  SELECT sh.open_time, sh.close_time, sh.closed
    INTO _open, _close, _closed
    FROM public.salon_hours sh
   WHERE sh.owner_id = _owner_id AND sh.weekday = _weekday;

  IF _open IS NULL THEN
    SELECT COALESCE(open_time, '10:00'::TIME), COALESCE(close_time, '19:00'::TIME), false
      INTO _open, _close, _closed
      FROM public.profiles WHERE id = _owner_id;
  END IF;

  IF _closed THEN RETURN; END IF;

  _earliest := now() + (_lead_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH slots AS (
    SELECT (_date + _open + (n || ' minutes')::INTERVAL)::TIMESTAMP AS slot_start
    FROM generate_series(0, EXTRACT(EPOCH FROM (_close - _open))::INTEGER / 60, 15) AS n
    WHERE (_date + _open + (n || ' minutes')::INTERVAL + _duration)::TIME <= _close
      AND (_date + _open + (n || ' minutes')::INTERVAL) AT TIME ZONE 'Asia/Tokyo' >= _earliest
  ),
  active_staff AS (
    SELECT s.id, ss.start_time, ss.end_time
    FROM public.staff s
    JOIN public.staff_schedules ss ON ss.staff_id = s.id
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND ss.weekday = _weekday AND ss.active = true
      AND (_location_id IS NULL OR s.location_id = _location_id)
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

CREATE OR REPLACE FUNCTION public.get_available_slots(_salon_slug text, _date date, _duration_minutes integer)
RETURNS TABLE(slot_time time without time zone, available_staff_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT slot_time, COALESCE(array_length(available_staff_ids, 1), 0)::integer
  FROM public.get_available_slots_by_staff(_salon_slug, _date, _duration_minutes, NULL::uuid)
  WHERE COALESCE(array_length(available_staff_ids, 1), 0) > 0
  ORDER BY slot_time;
$function$;
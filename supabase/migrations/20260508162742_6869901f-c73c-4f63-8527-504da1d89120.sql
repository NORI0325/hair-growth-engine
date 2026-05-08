-- public_create_booking_v3 を修正：booking 作成後に sync_jobs も作成する
CREATE OR REPLACE FUNCTION public.public_create_booking_v3(
  _salon_slug text,
  _full_name text,
  _phone text,
  _email text,
  _booking_date date,
  _booking_time time,
  _menus text[],
  _notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_id UUID;
  _location_id UUID;
  _customer_id UUID;
  _booking_id UUID;
  _test_mode BOOLEAN := false;
  _total_duration INTEGER := 0;
  _total_price INTEGER := 0;
  _menu_summary TEXT;
  _staff_id UUID;
  _weekday SMALLINT;
  _start_ts TIMESTAMP;
  _end_ts TIMESTAMP;
  _start_iso TEXT;
  _end_iso TEXT;
  _ci_record RECORD;
  _ext_staff_name TEXT;
  _ext_staff_id TEXT;
  _ext_menu_name TEXT;
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

  -- まず locations.public_slug を優先（マルチ店舗対応）
  SELECT l.tenant_id, l.id INTO _owner_id, _location_id
    FROM public.locations l
    WHERE l.public_slug = _salon_slug
    LIMIT 1;

  -- フォールバック: profiles.public_slug
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

  -- メニュー集計（location_id があれば店舗で絞る）
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

  -- 空きスタッフを自動選択（location_id があれば店舗で絞る）
  SELECT s.id INTO _staff_id
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
    NULLIF(trim(_notes), ''), 'pending', _test_mode, _staff_id,
    'line', 'public_form'
  )
  RETURNING id INTO _booking_id;

  -- === 外部媒体への同期ジョブ作成 ===
  FOR _ci_record IN
    SELECT channel FROM public.channel_integrations
    WHERE owner_id = _owner_id
      AND enabled = true
      AND sync_enabled = true
      AND (_location_id IS NULL OR location_id = _location_id)
  LOOP
    -- 自媒体への自己同期はスキップ
    CONTINUE WHEN _ci_record.channel = 'own_web';

    -- 顧客情報
    SELECT full_name, phone, email
    INTO _cust_name, _cust_phone, _cust_email
    FROM public.customers WHERE id = _customer_id;

    -- スタッフ情報
    SELECT name INTO _staff_name FROM public.staff WHERE id = _staff_id;
    SELECT external_name, external_id
    INTO _ext_staff_name, _ext_staff_id
    FROM public.staff_channel_mappings
    WHERE staff_id = _staff_id AND channel = _ci_record.channel;

    -- メニュー情報
    SELECT id INTO _menu_id FROM public.menu_items
    WHERE owner_id = _owner_id AND name = _menus[1] LIMIT 1;
    SELECT external_name INTO _ext_menu_name
    FROM public.menu_channel_mappings
    WHERE menu_id = _menu_id AND channel = _ci_record.channel;

    INSERT INTO public.sync_jobs (
      owner_id, location_id, reservation_id, target_channel, job_type, status, request_payload
    )
    VALUES (
      _owner_id, _location_id, _booking_id, _ci_record.channel, 'create_reservation', 'pending',
      jsonb_build_object(
        'customer_name', _cust_name,
        'customer_phone', _cust_phone,
        'customer_email', _cust_email,
        'start_time', _start_iso,
        'end_time', _end_iso,
        'staff_name', _staff_name,
        'external_staff_name', _ext_staff_name,
        'external_staff_id', _ext_staff_id,
        'menu_name', _menu_summary,
        'external_menu_name', _ext_menu_name,
        'notes', NULLIF(trim(_notes), ''),
        'source_channel', 'line'
      )
    );
  END LOOP;

  -- sync_jobs を作成した場合は bookings.sync_status = 'pending'
  IF EXISTS (SELECT 1 FROM public.sync_jobs WHERE reservation_id = _booking_id) THEN
    UPDATE public.bookings SET sync_status = 'pending' WHERE id = _booking_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', _booking_id,
    'location_id', _location_id,
    'staff_assigned', _staff_id IS NOT NULL
  );
END;
$$;
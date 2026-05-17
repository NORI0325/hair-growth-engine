
-- ============================================================
-- Phase 1: public_create_booking_v5 + get_available_slots_by_staff hardening
-- 目的: staff_id NULL の既存予約（SalonBoard由来など）を含む
--       同一location/時間帯の重複を厳密に検知・ブロックする
-- ============================================================

-- =====================================================
-- 1) get_available_slots_by_staff を v5ロジックで上書き
-- =====================================================
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

  SELECT l.tenant_id, l.id,
         COALESCE(l.open_time, p.open_time, '10:00'::TIME),
         COALESCE(l.close_time, p.close_time, '19:00'::TIME),
         COALESCE(p.booking_lead_time_hours, 24)
    INTO _owner_id, _location_id, _open, _close, _lead_hours
    FROM public.locations l
    JOIN public.profiles p ON p.id = l.tenant_id
   WHERE l.public_slug = _salon_slug
   LIMIT 1;

  IF _owner_id IS NULL THEN
    SELECT p.id, NULL::uuid,
           COALESCE(p.open_time, '10:00'::TIME),
           COALESCE(p.close_time, '19:00'::TIME),
           COALESCE(p.booking_lead_time_hours, 24)
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
    SELECT COALESCE(open_time, '10:00'::TIME),
           COALESCE(close_time, '19:00'::TIME), false
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
  -- 同一location内の staff_id NULL 予約数 (=店舗キャパを消費する分)
  null_staff_busy AS (
    SELECT sl.slot_start,
      COUNT(b.id)::INTEGER AS n
    FROM slots sl
    LEFT JOIN public.bookings b
      ON b.owner_id = _owner_id
      AND (_location_id IS NULL OR b.location_id = _location_id)
      AND b.staff_id IS NULL
      AND b.booking_date = _date
      AND b.status IN ('pending','confirmed','pending_sync')
      AND b.cancelled_at IS NULL
      AND tsrange(
        (_date + b.booking_time)::TIMESTAMP,
        (_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(sl.slot_start, sl.slot_start + _duration)
    GROUP BY sl.slot_start
  ),
  -- 各スロット×staffで「個別に空いているか」
  per_staff AS (
    SELECT
      sl.slot_start,
      a.id AS staff_id,
      (
        sl.slot_start::TIME >= a.start_time
        AND (sl.slot_start + _duration)::TIME <= a.end_time
        AND NOT EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.staff_id = a.id
            AND b.booking_date = _date
            AND b.status IN ('pending','confirmed','pending_sync')
            AND b.cancelled_at IS NULL
            AND tsrange(
              (_date + b.booking_time)::TIMESTAMP,
              (_date + b.booking_time + ((COALESCE(b.total_duration_minutes,60)) || ' minutes')::INTERVAL)::TIMESTAMP
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
      ) AS is_free
    FROM slots sl
    CROSS JOIN active_staff a
  ),
  agg AS (
    SELECT
      ps.slot_start,
      COALESCE(array_agg(ps.staff_id) FILTER (WHERE ps.is_free), ARRAY[]::uuid[]) AS free_ids,
      COUNT(*) FILTER (WHERE ps.is_free)::INTEGER AS free_count
    FROM per_staff ps
    GROUP BY ps.slot_start
  )
  SELECT
    ag.slot_start::TIME AS t,
    -- staff_id NULL 予約に「占有された」分だけ free_ids を削る
    -- (どのstaffを占有してるかは不明なので、capacityが0以下になったら全空き)
    CASE
      WHEN (ag.free_count - COALESCE(nb.n, 0)) <= 0 THEN ARRAY[]::uuid[]
      WHEN _staff_id IS NOT NULL THEN ag.free_ids
      ELSE ag.free_ids[1:GREATEST(ag.free_count - COALESCE(nb.n,0), 0)]
    END AS staff_ids
  FROM agg ag
  LEFT JOIN null_staff_busy nb ON nb.slot_start = ag.slot_start
  WHERE (ag.free_count - COALESCE(nb.n, 0)) > 0
    AND array_length(ag.free_ids, 1) > 0
  ORDER BY ag.slot_start::TIME;
END;
$function$;


-- =====================================================
-- 2) public_create_booking_v5
--    - 同一location/時間帯重複を staff_id NULL も含めて厳密判定
--    - pg_advisory_xact_lock(location) でレース防止
--    - INSERT直前に再チェック
-- =====================================================
CREATE OR REPLACE FUNCTION public.public_create_booking_v5(
  _salon_slug text,
  _full_name text,
  _full_name_kana text,
  _phone text,
  _email text,
  _booking_date date,
  _booking_time time without time zone,
  _menus text[],
  _notes text,
  _staff_id uuid DEFAULT NULL::uuid
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
  _cust_kana TEXT;
  _cust_phone TEXT;
  _cust_email TEXT;
  _name_kana TEXT;
  _scheduled_staff_count INTEGER := 0;
  _named_busy_count INTEGER := 0;
  _null_busy_count INTEGER := 0;
  _lock_key BIGINT;
BEGIN
  -- ---------- 入力バリデーション ----------
  IF _full_name IS NULL OR length(trim(_full_name)) < 1 OR length(_full_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name');
  END IF;
  _name_kana := COALESCE(trim(_full_name_kana), '');
  IF _name_kana = '' OR length(_name_kana) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name_kana');
  END IF;
  IF _name_kana !~ '^[ぁ-んァ-ヶー\s　]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name_kana_chars');
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

  -- ---------- サロン解決 ----------
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

  -- ---------- メニュー集計 ----------
  SELECT COALESCE(SUM(duration_minutes + buffer_minutes), 60),
         COALESCE(SUM(price), 0)
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

  -- ---------- ★ Advisory Lock (同一location_idの予約作成を直列化) ----------
  _lock_key := hashtextextended(COALESCE(_location_id::text, _owner_id::text), 0);
  PERFORM pg_advisory_xact_lock(_lock_key);

  -- ---------- 重複判定 ----------
  IF _staff_id IS NOT NULL THEN
    -- 指名スタッフの存在 / シフト確認
    SELECT s.id INTO _resolved_staff_id
    FROM public.staff s
    JOIN public.staff_schedules ss
      ON ss.staff_id = s.id AND ss.weekday = _weekday AND ss.active = true
    WHERE s.id = _staff_id
      AND s.owner_id = _owner_id
      AND s.active = true
      AND s.bookable = true
      AND (_location_id IS NULL OR s.location_id = _location_id)
      AND _booking_time >= ss.start_time
      AND _end_ts::TIME <= ss.end_time
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off t
        WHERE t.staff_id = s.id
          AND tstzrange(t.start_at, t.end_at) && tstzrange(
            (_start_ts AT TIME ZONE 'Asia/Tokyo'),
            (_end_ts AT TIME ZONE 'Asia/Tokyo')
          )
      )
    LIMIT 1;

    IF _resolved_staff_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'staff_unavailable');
    END IF;

    -- 指名スタッフ本人の重複
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.staff_id = _resolved_staff_id
        AND b.booking_date = _booking_date
        AND b.status IN ('pending','confirmed','pending_sync')
        AND b.cancelled_at IS NULL
        AND tsrange(
          (_booking_date + b.booking_time)::TIMESTAMP,
          (_booking_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
        ) && tsrange(_start_ts, _end_ts)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'slot_just_taken');
    END IF;

    -- 店舗キャパ判定:
    -- 同時間帯で「シフトに入ってる全スタッフ数」 vs 「既存予約数(named + null)」
    SELECT COUNT(DISTINCT s.id)::INTEGER INTO _scheduled_staff_count
    FROM public.staff s
    JOIN public.staff_schedules ss
      ON ss.staff_id = s.id AND ss.weekday = _weekday AND ss.active = true
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND (_location_id IS NULL OR s.location_id = _location_id)
      AND _booking_time >= ss.start_time
      AND _end_ts::TIME <= ss.end_time;

    SELECT COUNT(*)::INTEGER INTO _named_busy_count
    FROM public.bookings b
    WHERE b.owner_id = _owner_id
      AND (_location_id IS NULL OR b.location_id = _location_id)
      AND b.staff_id IS NOT NULL
      AND b.booking_date = _booking_date
      AND b.status IN ('pending','confirmed','pending_sync')
      AND b.cancelled_at IS NULL
      AND tsrange(
        (_booking_date + b.booking_time)::TIMESTAMP,
        (_booking_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(_start_ts, _end_ts);

    SELECT COUNT(*)::INTEGER INTO _null_busy_count
    FROM public.bookings b
    WHERE b.owner_id = _owner_id
      AND (_location_id IS NULL OR b.location_id = _location_id)
      AND b.staff_id IS NULL
      AND b.booking_date = _booking_date
      AND b.status IN ('pending','confirmed','pending_sync')
      AND b.cancelled_at IS NULL
      AND tsrange(
        (_booking_date + b.booking_time)::TIMESTAMP,
        (_booking_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(_start_ts, _end_ts);

    -- 今回の予約を加えると capacity を超える場合はブロック
    IF (_named_busy_count + _null_busy_count + 1) > _scheduled_staff_count THEN
      RETURN jsonb_build_object('success', false, 'error', 'slot_just_taken');
    END IF;

  ELSE
    -- 指名なし: 店舗キャパで判定
    SELECT COUNT(DISTINCT s.id)::INTEGER INTO _scheduled_staff_count
    FROM public.staff s
    JOIN public.staff_schedules ss
      ON ss.staff_id = s.id AND ss.weekday = _weekday AND ss.active = true
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND (_location_id IS NULL OR s.location_id = _location_id)
      AND _booking_time >= ss.start_time
      AND _end_ts::TIME <= ss.end_time
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off t
        WHERE t.staff_id = s.id
          AND tstzrange(t.start_at, t.end_at) && tstzrange(
            (_start_ts AT TIME ZONE 'Asia/Tokyo'),
            (_end_ts AT TIME ZONE 'Asia/Tokyo')
          )
      );

    IF _scheduled_staff_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_available_staff');
    END IF;

    SELECT COUNT(*)::INTEGER INTO _named_busy_count
    FROM public.bookings b
    WHERE b.owner_id = _owner_id
      AND (_location_id IS NULL OR b.location_id = _location_id)
      AND b.staff_id IS NOT NULL
      AND b.booking_date = _booking_date
      AND b.status IN ('pending','confirmed','pending_sync')
      AND b.cancelled_at IS NULL
      AND tsrange(
        (_booking_date + b.booking_time)::TIMESTAMP,
        (_booking_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(_start_ts, _end_ts);

    SELECT COUNT(*)::INTEGER INTO _null_busy_count
    FROM public.bookings b
    WHERE b.owner_id = _owner_id
      AND (_location_id IS NULL OR b.location_id = _location_id)
      AND b.staff_id IS NULL
      AND b.booking_date = _booking_date
      AND b.status IN ('pending','confirmed','pending_sync')
      AND b.cancelled_at IS NULL
      AND tsrange(
        (_booking_date + b.booking_time)::TIMESTAMP,
        (_booking_date + b.booking_time + (COALESCE(b.total_duration_minutes,60) || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(_start_ts, _end_ts);

    IF (_named_busy_count + _null_busy_count + 1) > _scheduled_staff_count THEN
      RETURN jsonb_build_object('success', false, 'error', 'slot_just_taken');
    END IF;

    -- 空いてるスタッフを1人解決 (named_busy分を除いた最初の一人)
    SELECT s.id INTO _resolved_staff_id
    FROM public.staff s
    JOIN public.staff_schedules ss
      ON ss.staff_id = s.id AND ss.weekday = _weekday AND ss.active = true
    WHERE s.owner_id = _owner_id
      AND s.active = true AND s.bookable = true
      AND (_location_id IS NULL OR s.location_id = _location_id)
      AND _booking_time >= ss.start_time
      AND _end_ts::TIME <= ss.end_time
      AND NOT EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.staff_id = s.id
          AND b.booking_date = _booking_date
          AND b.status IN ('pending','confirmed','pending_sync')
          AND b.cancelled_at IS NULL
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
    ORDER BY s.sort_order NULLS LAST, s.created_at
    LIMIT 1;
    -- 指名なしで空きスタッフが見つからない場合でも、キャパ判定はOKなのでstaff_id NULLで通す
  END IF;

  -- ---------- 顧客解決 ----------
  SELECT id INTO _customer_id
  FROM public.customers
  WHERE owner_id = _owner_id AND phone = _phone
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO public.customers (owner_id, location_id, full_name, name_kana, phone, email, is_test)
    VALUES (_owner_id, _location_id, trim(_full_name), _name_kana, trim(_phone), NULLIF(trim(_email), ''), _test_mode)
    RETURNING id INTO _customer_id;
  ELSE
    UPDATE public.customers SET name_kana = _name_kana
    WHERE id = _customer_id AND (name_kana IS NULL OR name_kana = '');
  END IF;

  -- ---------- 予約INSERT ----------
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

  -- ---------- 同期ジョブ生成 (v4と同等) ----------
  FOR _ci_record IN
    SELECT channel FROM public.channel_integrations
    WHERE owner_id = _owner_id
      AND enabled = true
      AND sync_enabled = true
      AND connection_status = 'live'
      AND (_location_id IS NULL OR location_id = _location_id)
  LOOP
    CONTINUE WHEN _ci_record.channel = 'own_web';

    SELECT full_name, name_kana, phone, email
    INTO _cust_name, _cust_kana, _cust_phone, _cust_email
    FROM public.customers WHERE id = _customer_id;

    IF _resolved_staff_id IS NULL THEN
      _staff_name := NULL;
      _ext_staff_name := '指名なし / フリー';
      _ext_staff_id := '0000000000';
    ELSE
      SELECT name INTO _staff_name FROM public.staff WHERE id = _resolved_staff_id;
      SELECT external_name, external_id
      INTO _ext_staff_name, _ext_staff_id
      FROM public.staff_channel_mappings
      WHERE staff_id = _resolved_staff_id
        AND channel = _ci_record.channel
        AND enabled = true
      LIMIT 1;
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
        'customer_kana', COALESCE(_cust_kana, ''),
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
        'external_staff_id', _ext_staff_id,
        'stylistId', _ext_staff_id,
        'menu_id', _menu_id,
        'menu_name', _menu_summary,
        'external_menu_name', _ext_menu_name,
        'external_menu_id', COALESCE(_salonboard_setmenu_id, _external_menu_id),
        'salonboard_setmenu_id', COALESCE(_salonboard_setmenu_id, _external_menu_id),
        'notes', NULLIF(trim(_notes), ''),
        'source_channel', 'line'
      )
    );

    UPDATE public.bookings
       SET sync_status = 'pending', source_channel = 'line'
     WHERE id = _booking_id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'booking_id', _booking_id, 'staff_id', _resolved_staff_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.public_create_booking_v5(text,text,text,text,text,date,time without time zone,text[],text,uuid) TO anon, authenticated;

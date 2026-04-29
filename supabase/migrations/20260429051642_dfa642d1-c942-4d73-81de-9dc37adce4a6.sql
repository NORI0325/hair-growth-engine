CREATE OR REPLACE FUNCTION public.public_create_booking_v2(
  _salon_slug text,
  _full_name text,
  _phone text,
  _email text,
  _booking_date date,
  _booking_time time without time zone,
  _menus text[],
  _notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner_id UUID;
  _customer_id UUID;
  _booking_id UUID;
  _test_mode BOOLEAN := false;
  _total_duration INTEGER := 0;
  _total_price INTEGER := 0;
  _menu_summary TEXT;
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

  SELECT id, COALESCE(test_mode, false) INTO _owner_id, _test_mode FROM public.profiles WHERE public_slug = _salon_slug;
  IF _owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'salon_not_found');
  END IF;

  -- メニューの合計を集計
  SELECT COALESCE(SUM(duration_minutes + buffer_minutes), 0), COALESCE(SUM(price), 0)
    INTO _total_duration, _total_price
    FROM public.menu_items
   WHERE owner_id = _owner_id AND name = ANY(_menus) AND active = true;

  _menu_summary := array_to_string(_menus, ' + ');

  SELECT id INTO _customer_id
  FROM public.customers
  WHERE owner_id = _owner_id AND phone = _phone
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO public.customers (owner_id, full_name, phone, email, is_test)
    VALUES (_owner_id, trim(_full_name), trim(_phone), NULLIF(trim(_email), ''), _test_mode)
    RETURNING id INTO _customer_id;
  END IF;

  INSERT INTO public.bookings (
    owner_id, customer_id, booking_date, booking_time,
    menu, menus, total_duration_minutes, total_price,
    notes, status, is_test
  )
  VALUES (
    _owner_id, _customer_id, _booking_date, _booking_time,
    left(_menu_summary, 200), _menus, _total_duration, _total_price,
    NULLIF(trim(_notes), ''), 'pending', _test_mode
  )
  RETURNING id INTO _booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', _booking_id);
END;
$function$;
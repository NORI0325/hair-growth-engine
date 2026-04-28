
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bookings_owner_is_test ON public.bookings(owner_id, is_test);
CREATE INDEX IF NOT EXISTS idx_customers_owner_is_test ON public.customers(owner_id, is_test);

CREATE OR REPLACE FUNCTION public.public_create_booking(_salon_slug text, _full_name text, _phone text, _email text, _booking_date date, _booking_time time without time zone, _menu text, _notes text)
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
  IF _menu IS NULL OR length(_menu) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_menu');
  END IF;

  SELECT id, COALESCE(test_mode, false) INTO _owner_id, _test_mode FROM public.profiles WHERE public_slug = _salon_slug;
  IF _owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'salon_not_found');
  END IF;

  SELECT id INTO _customer_id
  FROM public.customers
  WHERE owner_id = _owner_id AND phone = _phone
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO public.customers (owner_id, full_name, phone, email, is_test)
    VALUES (_owner_id, trim(_full_name), trim(_phone), NULLIF(trim(_email), ''), _test_mode)
    RETURNING id INTO _customer_id;
  END IF;

  INSERT INTO public.bookings (owner_id, customer_id, booking_date, booking_time, menu, notes, status, is_test)
  VALUES (_owner_id, _customer_id, _booking_date, _booking_time, _menu, NULLIF(trim(_notes), ''), 'pending', _test_mode)
  RETURNING id INTO _booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', _booking_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_test_data(_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _bookings_count INTEGER;
  _customers_count INTEGER;
BEGIN
  IF _owner_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  DELETE FROM public.bookings WHERE owner_id = _owner_id AND is_test = true;
  GET DIAGNOSTICS _bookings_count = ROW_COUNT;

  DELETE FROM public.customers WHERE owner_id = _owner_id AND is_test = true;
  GET DIAGNOSTICS _customers_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted_bookings', _bookings_count, 'deleted_customers', _customers_count);
END;
$function$;

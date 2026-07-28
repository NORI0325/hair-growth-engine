-- Final database guard for future booking writes. Existing rows are not
-- rewritten. The advisory lock closes the race between concurrent booking
-- requests for the same staff member and day.
CREATE OR REPLACE FUNCTION public.guard_booking_location_and_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _is_external_mirror boolean;
  _new_start timestamp;
  _new_end timestamp;
  _salonboard_live boolean := false;
  _syncable_count integer := 0;
  _authoritative_duration integer := NULL;
  _authoritative_price integer := NULL;
  _validate_salonboard_menu boolean := false;
BEGIN
  _is_external_mirror :=
    lower(COALESCE(NEW.source_channel, '')) IN ('salonboard', 'hotpepper', 'minimo', 'rakuten_beauty')
    OR lower(COALESCE(NEW.external_source, '')) IN (
      'salonboard', 'salonboard_email', 'salonboard_import', 'salonboard_manual',
      'hotpepper', 'minimo', 'rakuten_beauty'
    )
    OR lower(COALESCE(NEW.external_source, '')) LIKE 'salonboard_%';

  IF NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'booking_location_required' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = NEW.location_id AND l.tenant_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'booking_location_owner_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.customer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.customers c
     WHERE c.id = NEW.customer_id
       AND (c.owner_id <> NEW.owner_id OR (c.location_id IS NOT NULL AND c.location_id <> NEW.location_id))
  ) THEN
    RAISE EXCEPTION 'booking_customer_location_mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.channel_integrations ci
     WHERE ci.owner_id = NEW.owner_id
       AND ci.location_id = NEW.location_id
       AND ci.channel = 'salonboard'
       AND ci.enabled = true
       AND ci.sync_enabled = true
       AND ci.connection_status = 'live'
  ) INTO _salonboard_live;

  -- All SalonBoost-origin reservations for a live store use the exact same
  -- authoritative setmenu rule, regardless of which UI/Edge path inserted it.
  IF _salonboard_live
     AND NOT _is_external_mirror
     AND COALESCE(NEW.is_test, false) = false THEN
    IF TG_OP = 'INSERT' THEN
      _validate_salonboard_menu := true;
    ELSE
      _validate_salonboard_menu :=
        NEW.owner_id IS DISTINCT FROM OLD.owner_id
        OR NEW.location_id IS DISTINCT FROM OLD.location_id
        OR NEW.menu IS DISTINCT FROM OLD.menu
        OR NEW.total_duration_minutes IS DISTINCT FROM OLD.total_duration_minutes
        OR NEW.total_price IS DISTINCT FROM OLD.total_price
        OR NEW.source_channel IS DISTINCT FROM OLD.source_channel
        OR NEW.external_source IS DISTINCT FROM OLD.external_source;
    END IF;
  END IF;

  IF _validate_salonboard_menu THEN
    SELECT COUNT(*), MAX(cmo.rsv_term), MAX(cmo.price)
      INTO _syncable_count, _authoritative_duration, _authoritative_price
      FROM public.menu_items mi
      JOIN public.menu_channel_mappings mcm
        ON mcm.menu_id = mi.id
       AND mcm.owner_id = NEW.owner_id
       AND mcm.location_id = NEW.location_id
       AND mcm.channel = 'salonboard'
       AND mcm.enabled = true
      JOIN public.channel_menu_options cmo
        ON cmo.owner_id = NEW.owner_id
       AND cmo.location_id = NEW.location_id
       AND cmo.channel = 'salonboard'
       AND cmo.source_type = 'setmenu'
       AND cmo.active = true
       AND cmo.setmenu_id = COALESCE(NULLIF(mcm.external_setmenu_id, ''), mcm.external_id)
     WHERE mi.owner_id = NEW.owner_id
       AND mi.location_id = NEW.location_id
       AND mi.name = NEW.menu
       AND mi.active = true
       AND COALESCE(NULLIF(mcm.external_setmenu_id, ''), mcm.external_id) ~ '^SN[0-9]+$'
       AND mcm.rsv_term IS NOT NULL
       AND cmo.rsv_term IS NOT NULL
       AND cmo.price IS NOT NULL
       AND mcm.rsv_term = cmo.rsv_term;

    IF _syncable_count <> 1 OR _authoritative_duration IS NULL OR _authoritative_price IS NULL THEN
      RAISE EXCEPTION 'salonboard_menu_not_syncable' USING ERRCODE = '23514';
    END IF;
    NEW.total_duration_minutes := _authoritative_duration;
    NEW.total_price := _authoritative_price;
  END IF;

  IF NEW.total_duration_minutes IS NULL OR NEW.total_duration_minutes <= 0 THEN
    IF _is_external_mirror THEN
      NEW.needs_manual_review := true;
      NEW.sync_status := 'needs_review';
      NEW.sync_error_message := COALESCE(
        NULLIF(NEW.sync_error_message, ''),
        '外部予約の所要時間が未取得です。サロンボード本体で確認してください。'
      );
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'booking_duration_required' USING ERRCODE = '23514';
  END IF;

  IF NEW.staff_id IS NULL OR NEW.status IN ('cancelled', 'completed', 'no_show') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
     WHERE s.id = NEW.staff_id
       AND s.owner_id = NEW.owner_id
       AND s.location_id = NEW.location_id
       AND COALESCE(s.active, true) = true
  ) THEN
    IF _is_external_mirror THEN
      NEW.staff_id := NULL;
      NEW.needs_manual_review := true;
      NEW.sync_status := 'needs_review';
      NEW.sync_error_message := COALESCE(
        NULLIF(NEW.sync_error_message, ''),
        '外部予約の担当者を店舗スタッフへ紐付けできませんでした。サロンボード本体で確認してください。'
      );
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'booking_staff_location_mismatch' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.staff_id::text || ':' || NEW.booking_date::text, 0)
  );
  _new_start := NEW.booking_date::timestamp + NEW.booking_time;
  _new_end := _new_start + make_interval(mins => NEW.total_duration_minutes);

  IF EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.id IS DISTINCT FROM NEW.id
       AND b.owner_id = NEW.owner_id
       AND b.location_id = NEW.location_id
       AND b.staff_id = NEW.staff_id
       AND b.booking_date = NEW.booking_date
       AND b.status NOT IN ('cancelled', 'completed', 'no_show')
       AND (b.booking_date::timestamp + b.booking_time) < _new_end
       AND (
         b.booking_date::timestamp + b.booking_time
         + make_interval(mins => COALESCE(NULLIF(b.total_duration_minutes, 0), 1440))
       ) > _new_start
  ) THEN
    IF _is_external_mirror THEN
      NEW.needs_manual_review := true;
      NEW.sync_status := 'needs_review';
      NEW.sync_error_message := COALESCE(
        NULLIF(NEW.sync_error_message, ''),
        '外部予約が既存の担当枠と重複しています。サロンボード本体で確認してください。'
      );
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'booking_staff_time_conflict' USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_booking_location_and_overlap ON public.bookings;
CREATE TRIGGER trg_guard_booking_location_and_overlap
BEFORE INSERT OR UPDATE OF owner_id, location_id, customer_id, staff_id,
  booking_date, booking_time, total_duration_minutes, total_price, status, menu,
  source_channel, external_source, is_test
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_location_and_overlap();

CREATE INDEX IF NOT EXISTS idx_bookings_staff_day_active
  ON public.bookings(owner_id, location_id, staff_id, booking_date, booking_time)
  WHERE staff_id IS NOT NULL AND status NOT IN ('cancelled', 'completed', 'no_show');

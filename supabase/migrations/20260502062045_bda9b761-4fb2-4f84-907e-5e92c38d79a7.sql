-- 1) activated_at カラム追加
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_customers_activated_at ON public.customers(activated_at);

-- 2) バックフィル: 既に予約がある顧客 = アクティブ
UPDATE public.customers c
SET activated_at = COALESCE(c.activated_at, sub.first_booking_at, c.created_at)
FROM (
  SELECT customer_id, MIN(created_at) AS first_booking_at
  FROM public.bookings
  GROUP BY customer_id
) sub
WHERE c.id = sub.customer_id
  AND c.activated_at IS NULL;

-- サロンボード由来でない（=通常追加）顧客は最初からアクティブ扱い
UPDATE public.customers
SET activated_at = COALESCE(activated_at, created_at)
WHERE imported_from IS NULL AND activated_at IS NULL;

-- 3) 予約INSERTで顧客をアクティブ化するトリガー
CREATE OR REPLACE FUNCTION public.activate_customer_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customers
     SET activated_at = COALESCE(activated_at, now())
   WHERE id = NEW.customer_id
     AND activated_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activate_customer_on_booking ON public.bookings;
CREATE TRIGGER trg_activate_customer_on_booking
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.activate_customer_on_booking();

-- 4) 過去来店ベースのジョブ生成をスキップ：schedule_thank_you_on_complete を更新
CREATE OR REPLACE FUNCTION public.schedule_thank_you_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_visit_count INTEGER;
  _new_total_spent INTEGER;
  _old_visit_count INTEGER;
  _old_total_spent INTEGER;
  _old_tier TEXT;
  _new_tier TEXT;
  _has_review_url BOOLEAN;
  _menu_lower TEXT;
  _next_days INTEGER;
  _thank_you_at TIMESTAMPTZ;
  _aftercare_at TIMESTAMPTZ;
  _next_at TIMESTAMPTZ;
  _review_at TIMESTAMPTZ;
  _thank_delay INTEGER;
  _after_delay INTEGER;
  _imported_from TEXT;
  _activated_at TIMESTAMPTZ;
  _is_dormant_import BOOLEAN;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    SELECT visit_count, total_spent, imported_from, activated_at
      INTO _old_visit_count, _old_total_spent, _imported_from, _activated_at
      FROM public.customers WHERE id = NEW.customer_id;
    _old_tier := public.calculate_vip_tier(COALESCE(_old_visit_count,0), COALESCE(_old_total_spent,0));

    -- サロンボード由来 かつ 未アクティブ = 過去の来店をインポートしただけの可能性が高い
    -- 過去来店トリガー系（thank_you / aftercare / next_suggestion / reminder）はスキップ
    _is_dormant_import := (_imported_from = 'salonboard' AND _activated_at IS NULL);

    UPDATE public.customers
       SET last_visit_date = NEW.booking_date,
           visit_count = visit_count + 1,
           total_spent = total_spent + COALESCE(NEW.revenue, 0),
           activated_at = COALESCE(activated_at, now())  -- 来店確定でアクティブ化
     WHERE id = NEW.customer_id
    RETURNING visit_count, total_spent INTO _new_visit_count, _new_total_spent;

    _new_tier := public.calculate_vip_tier(COALESCE(_new_visit_count,0), COALESCE(_new_total_spent,0));

    IF _new_tier <> _old_tier
       AND ARRAY_POSITION(ARRAY['bronze','silver','gold','platinum'], _new_tier)
         > ARRAY_POSITION(ARRAY['bronze','silver','gold','platinum'], _old_tier)
    THEN
      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'vip_upgrade',
              GREATEST(now() + INTERVAL '30 minutes', ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo')),
              jsonb_build_object('tier', _new_tier, 'previous_tier', _old_tier));
    END IF;

    UPDATE public.scheduled_jobs
       SET status = 'cancelled', error = 'customer_returned'
     WHERE customer_id = NEW.customer_id
       AND job_type = 'reactivation'
       AND status = 'pending';

    -- 設定値を取得
    SELECT COALESCE(thank_you_delay_days, 1), COALESCE(aftercare_delay_days, 7)
      INTO _thank_delay, _after_delay
      FROM public.profiles WHERE id = NEW.owner_id;

    _menu_lower := lower(COALESCE(NEW.menu, ''));
    IF _menu_lower ~ '(カラー|color|パーマ|perm|縮毛|矯正)' THEN _next_days := 35;
    ELSIF _menu_lower ~ '(カット|cut)' AND _menu_lower !~ '(カラー|パーマ)' THEN _next_days := 45;
    ELSE _next_days := 30; END IF;

    _thank_you_at := ((NEW.booking_date + (_thank_delay || ' days')::interval)::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    _aftercare_at := ((NEW.booking_date + (_after_delay || ' days')::interval)::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    _next_at := ((NEW.booking_date + (_next_days || ' days')::interval)::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    _review_at := ((NEW.booking_date + INTERVAL '7 days')::date + TIME '11:00') AT TIME ZONE 'Asia/Tokyo';

    -- 休眠インポート判定なら過去来店トリガー系を生成しない
    IF NOT _is_dormant_import THEN
      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'thank_you',
              GREATEST(_thank_you_at, now() + INTERVAL '1 hour'),
              jsonb_build_object('menu', NEW.menu, 'booking_date', NEW.booking_date));

      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'aftercare',
              GREATEST(_aftercare_at, now() + INTERVAL '1 hour'),
              jsonb_build_object('menu', NEW.menu));

      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'next_suggestion',
              GREATEST(_next_at, now() + INTERVAL '1 hour'),
              jsonb_build_object('menu', NEW.menu, 'days_since_visit', _next_days));

      SELECT (google_review_url IS NOT NULL AND length(google_review_url) > 5)
        INTO _has_review_url
        FROM public.profiles WHERE id = NEW.owner_id;
      IF _new_visit_count >= 2 AND _has_review_url THEN
        INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
        VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'review_request',
                GREATEST(_review_at, now() + INTERVAL '1 hour'),
                jsonb_build_object('menu', NEW.menu));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5) リマインダー生成側も：未アクティブのインポート顧客にはリマインダー出さない
--   （実際は将来予約が入ればトリガーで activate されるので影響は小さいが念のため）
CREATE OR REPLACE FUNCTION public.schedule_reminder_on_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _enabled boolean;
  _hour integer;
  _scheduled timestamptz;
BEGIN
  IF NEW.booking_date <= CURRENT_DATE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(reminder_enabled, true), COALESCE(reminder_hour, 19)
    INTO _enabled, _hour
    FROM public.profiles WHERE id = NEW.owner_id;

  IF NOT COALESCE(_enabled, true) THEN
    RETURN NEW;
  END IF;

  _scheduled := ((NEW.booking_date - INTERVAL '1 day')::date + (_hour || ' hours')::interval) AT TIME ZONE 'Asia/Tokyo';

  IF _scheduled <= now() THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scheduled_jobs
     WHERE booking_id = NEW.id AND job_type = 'reminder'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
  VALUES (
    NEW.owner_id, NEW.customer_id, NEW.id, 'reminder', _scheduled,
    jsonb_build_object('menu', NEW.menu, 'booking_date', NEW.booking_date, 'booking_time', NEW.booking_time)
  );

  RETURN NEW;
END;
$function$;

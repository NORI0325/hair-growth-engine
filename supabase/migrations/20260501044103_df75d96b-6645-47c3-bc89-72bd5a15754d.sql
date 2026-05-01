
-- 1) referred_by カラム追加
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_referred_by ON public.customers(referred_by) WHERE referred_by IS NOT NULL;

-- 2) welcome ジョブ：顧客作成時に即時生成
CREATE OR REPLACE FUNCTION public.schedule_welcome_on_customer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.is_test, false) = true THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  VALUES (
    NEW.owner_id, NEW.id, 'welcome',
    GREATEST(now() + INTERVAL '5 minutes', ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo')),
    jsonb_build_object('source', 'customer_insert')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_welcome ON public.customers;
CREATE TRIGGER trg_schedule_welcome
  AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.schedule_welcome_on_customer_insert();

-- 3) referral_thanks ジョブ：referred_by が設定された瞬間に生成
CREATE OR REPLACE FUNCTION public.schedule_referral_thanks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- INSERT時 or UPDATE時に referred_by が新たに付いた場合
  IF NEW.referred_by IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.referred_by IS NOT DISTINCT FROM NEW.referred_by THEN
    RETURN NEW;
  END IF;

  -- 紹介者(referrer)向けに感謝ジョブを発行
  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  VALUES (
    NEW.owner_id, NEW.referred_by, 'referral_thanks',
    GREATEST(now() + INTERVAL '5 minutes', ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo')),
    jsonb_build_object('referred_customer_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_referral_thanks ON public.customers;
CREATE TRIGGER trg_schedule_referral_thanks
  AFTER INSERT OR UPDATE OF referred_by ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.schedule_referral_thanks();

-- 4) VIP昇格通知：bookings completion時にtier比較
--    既存 schedule_thank_you_on_complete を拡張
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
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    -- 旧tier計算用に更新前の値を取得
    SELECT visit_count, total_spent INTO _old_visit_count, _old_total_spent
      FROM public.customers WHERE id = NEW.customer_id;
    _old_tier := public.calculate_vip_tier(COALESCE(_old_visit_count,0), COALESCE(_old_total_spent,0));

    UPDATE public.customers
       SET last_visit_date = NEW.booking_date,
           visit_count = visit_count + 1,
           total_spent = total_spent + COALESCE(NEW.revenue, 0)
     WHERE id = NEW.customer_id
    RETURNING visit_count, total_spent INTO _new_visit_count, _new_total_spent;

    _new_tier := public.calculate_vip_tier(COALESCE(_new_visit_count,0), COALESCE(_new_total_spent,0));

    -- VIPランクが上がったら昇格通知ジョブを生成
    IF _new_tier <> _old_tier
       AND ARRAY_POSITION(ARRAY['bronze','silver','gold','platinum'], _new_tier)
         > ARRAY_POSITION(ARRAY['bronze','silver','gold','platinum'], _old_tier)
    THEN
      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'vip_upgrade',
              GREATEST(now() + INTERVAL '30 minutes', ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo')),
              jsonb_build_object('tier', _new_tier, 'previous_tier', _old_tier));
    END IF;

    -- reactivationキャンセル
    UPDATE public.scheduled_jobs
       SET status = 'cancelled', error = 'customer_returned'
     WHERE customer_id = NEW.customer_id
       AND job_type = 'reactivation'
       AND status = 'pending';

    _menu_lower := lower(COALESCE(NEW.menu, ''));

    IF _menu_lower ~ '(カラー|color|パーマ|perm|縮毛|矯正)' THEN
      _next_days := 35;
    ELSIF _menu_lower ~ '(カット|cut)' AND _menu_lower !~ '(カラー|パーマ)' THEN
      _next_days := 45;
    ELSE
      _next_days := 30;
    END IF;

    _thank_you_at := ((NEW.booking_date + INTERVAL '1 day')::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    _aftercare_at := ((NEW.booking_date + INTERVAL '7 days')::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    _next_at := ((NEW.booking_date + (_next_days || ' days')::interval)::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    _review_at := ((NEW.booking_date + INTERVAL '7 days')::date + TIME '11:00') AT TIME ZONE 'Asia/Tokyo';

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
  RETURN NEW;
END;
$function$;

-- 5) anniversary 日次cron関数：初回来店日の◯周年該当者を抽出
CREATE OR REPLACE FUNCTION public.create_anniversary_jobs_for_today()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count INTEGER := 0;
BEGIN
  -- 各顧客の最古の completed 予約日を「初回来店日」として、本日が同月同日かつ年差が1年以上の顧客にジョブ生成
  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT
    c.owner_id,
    c.id,
    'anniversary',
    ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
    jsonb_build_object(
      'years', EXTRACT(YEAR FROM AGE(CURRENT_DATE, first_visit.first_date))::int,
      'first_visit_date', first_visit.first_date
    )
  FROM public.customers c
  JOIN LATERAL (
    SELECT MIN(b.booking_date) AS first_date
      FROM public.bookings b
     WHERE b.customer_id = c.id AND b.status = 'completed'
  ) first_visit ON true
  WHERE first_visit.first_date IS NOT NULL
    AND COALESCE(c.is_test, false) = false
    AND EXTRACT(MONTH FROM first_visit.first_date) = EXTRACT(MONTH FROM CURRENT_DATE)
    AND EXTRACT(DAY   FROM first_visit.first_date) = EXTRACT(DAY   FROM CURRENT_DATE)
    AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, first_visit.first_date))::int >= 1
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id
        AND j.job_type = 'anniversary'
        AND j.created_at::date = CURRENT_DATE
    );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

-- 6) cron: 毎日 0:30 UTC (= JST 9:30) に実行
DO $$
BEGIN
  PERFORM cron.unschedule('anniversary-jobs-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'anniversary-jobs-daily',
  '30 0 * * *',
  $$ SELECT public.create_anniversary_jobs_for_today(); $$
);

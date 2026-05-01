
-- 1. profiles 列追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reactivation_stages JSONB NOT NULL DEFAULT
    '[{"days":30,"discount_percent":10,"label":"お久しぶり"},{"days":60,"discount_percent":15,"label":"そろそろ"},{"days":90,"discount_percent":20,"label":"おかえりなさい"},{"days":150,"discount_percent":30,"label":"特別ご招待"}]'::jsonb,
  ADD COLUMN IF NOT EXISTS birthday_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS birthday_discount_percent INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS thank_you_delay_days INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS aftercare_delay_days INTEGER NOT NULL DEFAULT 7;

-- 2. 離脱客ジョブ生成 — JSONBループ版に書き換え
CREATE OR REPLACE FUNCTION public.create_reactivation_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count INTEGER := 0;
  _stage_count INTEGER;
BEGIN
  WITH stage_rows AS (
    SELECT
      p.id AS owner_id,
      (s.idx - 1)::int AS stage_index,
      (s.stage->>'days')::int AS days,
      COALESCE((s.stage->>'discount_percent')::int, 20) AS discount_percent,
      COALESCE(s.stage->>'label', '') AS label
    FROM public.profiles p,
    LATERAL jsonb_array_elements(COALESCE(p.reactivation_stages, '[]'::jsonb))
      WITH ORDINALITY AS s(stage, idx)
    WHERE COALESCE(p.reactivation_enabled, true) = true
      AND jsonb_typeof(p.reactivation_stages) = 'array'
  ),
  inserted AS (
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
    SELECT
      c.owner_id, c.id, 'reactivation',
      ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
      jsonb_build_object(
        'stage', sr.stage_index + 1,
        'stage_index', sr.stage_index,
        'days_since', (CURRENT_DATE - c.last_visit_date),
        'discount_percent', sr.discount_percent,
        'label', sr.label
      )
    FROM public.customers c
    JOIN stage_rows sr ON sr.owner_id = c.owner_id
    WHERE c.last_visit_date BETWEEN
            CURRENT_DATE - (sr.days + 3) * INTERVAL '1 day'
        AND CURRENT_DATE - (sr.days - 3) * INTERVAL '1 day'
      AND COALESCE(c.is_test, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.scheduled_jobs j
        WHERE j.customer_id = c.id
          AND j.job_type = 'reactivation'
          AND COALESCE((j.payload->>'stage_index')::int, (j.payload->>'stage')::int - 1) = sr.stage_index
          AND j.created_at > c.last_visit_date::timestamptz
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO _count FROM inserted;

  RETURN _count;
END;
$function$;

-- 3. サンクス・アフターケアの遅延日数を profiles から参照
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
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
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

-- 4. 誕生日ジョブ：birthday_enabled=false ならスキップ + discount_percent を payload に追加
CREATE OR REPLACE FUNCTION public.create_birthday_jobs_for_month()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count INTEGER := 0;
BEGIN
  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT
    c.owner_id, c.id, 'birthday', now(),
    jsonb_build_object(
      'month', EXTRACT(MONTH FROM CURRENT_DATE),
      'discount_percent', COALESCE(p.birthday_discount_percent, 30)
    )
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.birthday IS NOT NULL
    AND COALESCE(p.birthday_enabled, true) = true
    AND EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id
        AND j.job_type = 'birthday'
        AND date_trunc('month', j.created_at) = date_trunc('month', CURRENT_DATE)
    );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$function$;

-- 5. 段階削除時の未送信ジョブクリーンアップ用ヘルパー
CREATE OR REPLACE FUNCTION public.cancel_orphan_reactivation_jobs(_owner_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count INTEGER := 0;
  _max_index INTEGER;
BEGIN
  IF _owner_id <> auth.uid() THEN
    RETURN 0;
  END IF;

  SELECT GREATEST(jsonb_array_length(COALESCE(reactivation_stages, '[]'::jsonb)) - 1, -1)
    INTO _max_index
    FROM public.profiles WHERE id = _owner_id;

  UPDATE public.scheduled_jobs
     SET status = 'cancelled', error = 'stage_removed_by_owner'
   WHERE owner_id = _owner_id
     AND job_type = 'reactivation'
     AND status = 'pending'
     AND COALESCE((payload->>'stage_index')::int, (payload->>'stage')::int - 1) > _max_index;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$function$;

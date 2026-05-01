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
  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT c.owner_id, c.id, 'reactivation',
         ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
         jsonb_build_object('stage', 1, 'days_since', (CURRENT_DATE - c.last_visit_date))
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.last_visit_date BETWEEN CURRENT_DATE - INTERVAL '33 days' AND CURRENT_DATE - INTERVAL '27 days'
    AND COALESCE(p.reactivation_enabled, true) = true
    AND COALESCE(c.is_test, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id AND j.job_type = 'reactivation'
        AND (j.payload->>'stage')::int = 1
        AND j.created_at > c.last_visit_date::timestamptz
    );
  GET DIAGNOSTICS _stage_count = ROW_COUNT; _count := _count + _stage_count;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT c.owner_id, c.id, 'reactivation',
         ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
         jsonb_build_object('stage', 2, 'days_since', (CURRENT_DATE - c.last_visit_date))
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.last_visit_date BETWEEN CURRENT_DATE - INTERVAL '63 days' AND CURRENT_DATE - INTERVAL '57 days'
    AND COALESCE(p.reactivation_enabled, true) = true
    AND COALESCE(c.is_test, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id AND j.job_type = 'reactivation'
        AND (j.payload->>'stage')::int = 2
        AND j.created_at > c.last_visit_date::timestamptz
    );
  GET DIAGNOSTICS _stage_count = ROW_COUNT; _count := _count + _stage_count;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT c.owner_id, c.id, 'reactivation',
         ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
         jsonb_build_object('stage', 3, 'days_since', (CURRENT_DATE - c.last_visit_date))
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.last_visit_date BETWEEN CURRENT_DATE - INTERVAL '93 days' AND CURRENT_DATE - INTERVAL '87 days'
    AND COALESCE(p.reactivation_enabled, true) = true
    AND COALESCE(c.is_test, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id AND j.job_type = 'reactivation'
        AND (j.payload->>'stage')::int = 3
        AND j.created_at > c.last_visit_date::timestamptz
    );
  GET DIAGNOSTICS _stage_count = ROW_COUNT; _count := _count + _stage_count;

  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT c.owner_id, c.id, 'reactivation',
         ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
         jsonb_build_object('stage', 4, 'days_since', (CURRENT_DATE - c.last_visit_date))
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.last_visit_date BETWEEN CURRENT_DATE - INTERVAL '153 days' AND CURRENT_DATE - INTERVAL '147 days'
    AND COALESCE(p.reactivation_enabled, true) = true
    AND COALESCE(c.is_test, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id AND j.job_type = 'reactivation'
        AND (j.payload->>'stage')::int = 4
        AND j.created_at > c.last_visit_date::timestamptz
    );
  GET DIAGNOSTICS _stage_count = ROW_COUNT; _count := _count + _stage_count;

  RETURN _count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_thank_you_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_visit_count INTEGER;
  _has_review_url BOOLEAN;
  _menu_lower TEXT;
  _next_days INTEGER;
  _thank_you_at TIMESTAMPTZ;
  _aftercare_at TIMESTAMPTZ;
  _next_at TIMESTAMPTZ;
  _review_at TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    UPDATE public.customers
       SET last_visit_date = NEW.booking_date,
           visit_count = visit_count + 1,
           total_spent = total_spent + COALESCE(NEW.revenue, 0)
     WHERE id = NEW.customer_id
    RETURNING visit_count INTO _new_visit_count;

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

CREATE OR REPLACE FUNCTION public.create_default_coupons()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.coupons (owner_id, title, description, discount_type, discount_value, expires_at) VALUES
    (NEW.id, '🎟️ 次回ご来店 10%OFF',          '次回ご来店時、全メニュー10%OFFいたします。',                'percent', 10,   (CURRENT_DATE + INTERVAL '90 days')::date),
    (NEW.id, '🎟️ 次回ご来店 20%OFF',          'ご愛顧感謝、次回全メニュー20%OFFいたします。',              'percent', 20,   (CURRENT_DATE + INTERVAL '60 days')::date),
    (NEW.id, '💴 全メニュー ¥1,000 OFF',      'お会計より¥1,000割引いたします。',                          'amount',  1000, (CURRENT_DATE + INTERVAL '90 days')::date),
    (NEW.id, '💴 全メニュー ¥2,000 OFF',      'お会計より¥2,000割引いたします。',                          'amount',  2000, (CURRENT_DATE + INTERVAL '60 days')::date),
    (NEW.id, '🎂 お誕生月特別 30%OFF',         'お誕生月のご来店で全メニュー30%OFF。日頃の感謝を込めて。',  'percent', 30,   NULL),
    (NEW.id, '💌 ご紹介ありがとう ¥1,500 OFF','ご紹介いただいたお客様へ、感謝を込めて¥1,500 OFF。',         'amount',  1500, NULL),
    (NEW.id, '✨ ご新規様 初回限定 20%OFF',    '初めてご来店のお客様限定、全メニュー20%OFFでお試しいただけます。','percent', 20, NULL),
    (NEW.id, '☕ 平日限定 15%OFF',             '月〜金のご来店で全メニュー15%OFF。',                        'percent', 15,   (CURRENT_DATE + INTERVAL '90 days')::date),
    (NEW.id, '🏆 5回目ご来店記念 ¥3,000 OFF', 'いつもありがとうございます。5回目のご来店を記念して特別割引。','amount',  3000, NULL),
    (NEW.id, '💇 カラー＋トリートメント セット ¥1,500 OFF', '同時ご利用でセット価格¥1,500 OFF。',           'amount',  1500, (CURRENT_DATE + INTERVAL '120 days')::date),
    (NEW.id, '🌸 お久しぶり 10%OFF',           'またお会いできるのを楽しみにしております。次回10%OFF。',     'percent', 10,   (CURRENT_DATE + INTERVAL '60 days')::date),
    (NEW.id, '💝 おかえりなさい 20%OFF',       '少しお時間が空きましたが、感謝を込めて20%OFFをお贈りします。','percent', 20,   (CURRENT_DATE + INTERVAL '45 days')::date),
    (NEW.id, '👑 特別ご招待 30%OFF + ヘッドスパ無料', '大切なお客様へ。30%OFFに加え、ヘッドスパを無料でお付けします。','percent', 30, (CURRENT_DATE + INTERVAL '60 days')::date);
  RETURN NEW;
END;
$function$;

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
  -- JST helper: 指定日の指定時刻(JST)をtimestamptzで返す
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

    _menu_lower := lower(COALESCE(NEW.menu, ''));

    -- メニュー別の次回提案タイミング（日数）
    IF _menu_lower ~ '(カラー|color|パーマ|perm|縮毛|矯正)' THEN
      _next_days := 35;  -- カラー/パーマ系: 5週
    ELSIF _menu_lower ~ '(カット|cut)' AND _menu_lower !~ '(カラー|パーマ)' THEN
      _next_days := 45;  -- カットのみ: 6-7週
    ELSE
      _next_days := 30;
    END IF;

    -- JST 朝の時刻にスケジュール
    -- お礼: 来店翌日 10:00 JST
    _thank_you_at := ((NEW.booking_date + INTERVAL '1 day')::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    -- アフターケア: 来店7日後 10:00 JST
    _aftercare_at := ((NEW.booking_date + INTERVAL '7 days')::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    -- 次回提案: 来店N日後 10:00 JST
    _next_at := ((NEW.booking_date + (_next_days || ' days')::interval)::date + TIME '10:00') AT TIME ZONE 'Asia/Tokyo';
    -- レビュー依頼: 来店7日後 11:00 JST
    _review_at := ((NEW.booking_date + INTERVAL '7 days')::date + TIME '11:00') AT TIME ZONE 'Asia/Tokyo';

    -- お礼（翌日朝）
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'thank_you',
            GREATEST(_thank_you_at, now() + INTERVAL '1 hour'),
            jsonb_build_object('menu', NEW.menu, 'booking_date', NEW.booking_date));

    -- アフターケア
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'aftercare',
            GREATEST(_aftercare_at, now() + INTERVAL '1 hour'),
            jsonb_build_object('menu', NEW.menu));

    -- 次回提案（メニュー別タイミング）
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'next_suggestion',
            GREATEST(_next_at, now() + INTERVAL '1 hour'),
            jsonb_build_object('menu', NEW.menu, 'days_since_visit', _next_days));

    -- レビュー依頼（2回目以降のみ、google_review_url設定時）
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

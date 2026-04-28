
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_review_url TEXT,
  ADD COLUMN IF NOT EXISTS line_add_friend_url TEXT,
  ADD COLUMN IF NOT EXISTS line_channel_access_token TEXT;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- schedule_thank_you_on_complete を拡張（review_request ジョブも登録）
CREATE OR REPLACE FUNCTION public.schedule_thank_you_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _new_visit_count INTEGER;
  _has_review_url BOOLEAN;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    UPDATE public.customers
       SET last_visit_date = NEW.booking_date,
           visit_count = visit_count + 1,
           total_spent = total_spent + COALESCE(NEW.revenue, 0)
     WHERE id = NEW.customer_id
    RETURNING visit_count INTO _new_visit_count;

    -- サンクスメール（24時間後）
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (
      NEW.owner_id, NEW.customer_id, NEW.id, 'thank_you',
      now() + interval '24 hours',
      jsonb_build_object('menu', NEW.menu, 'booking_date', NEW.booking_date)
    );

    -- Googleレビュー依頼（3日後・2回目以降の来店者のみ・URL登録済みのサロンのみ）
    SELECT (google_review_url IS NOT NULL AND length(google_review_url) > 5)
      INTO _has_review_url
      FROM public.profiles WHERE id = NEW.owner_id;

    IF _new_visit_count >= 2 AND _has_review_url THEN
      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (
        NEW.owner_id, NEW.customer_id, NEW.id, 'review_request',
        now() + interval '3 days',
        jsonb_build_object('menu', NEW.menu)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

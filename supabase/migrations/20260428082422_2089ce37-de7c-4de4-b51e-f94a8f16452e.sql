
-- LINE配信ログ
CREATE TABLE IF NOT EXISTS public.line_message_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  customer_id UUID,
  job_type TEXT NOT NULL,
  line_user_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_message_log_owner_created_idx
  ON public.line_message_log (owner_id, created_at DESC);

ALTER TABLE public.line_message_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner line log read" ON public.line_message_log;
CREATE POLICY "owner line log read"
  ON public.line_message_log FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

-- 来店後ステップ配信（7日後 / 30日後）を schedule_thank_you_on_complete に統合
CREATE OR REPLACE FUNCTION public.schedule_thank_you_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    -- 24時間後：サンクス
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'thank_you',
            now() + interval '24 hours',
            jsonb_build_object('menu', NEW.menu, 'booking_date', NEW.booking_date));

    -- 7日後：ヘアケア案内（ステップ2）
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'aftercare',
            now() + interval '7 days',
            jsonb_build_object('menu', NEW.menu));

    -- 30日後：次回提案（ステップ3）
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'next_suggestion',
            now() + interval '30 days',
            jsonb_build_object('menu', NEW.menu));

    -- レビュー依頼
    SELECT (google_review_url IS NOT NULL AND length(google_review_url) > 5)
      INTO _has_review_url
      FROM public.profiles WHERE id = NEW.owner_id;
    IF _new_visit_count >= 2 AND _has_review_url THEN
      INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
      VALUES (NEW.owner_id, NEW.customer_id, NEW.id, 'review_request',
              now() + interval '3 days',
              jsonb_build_object('menu', NEW.menu));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

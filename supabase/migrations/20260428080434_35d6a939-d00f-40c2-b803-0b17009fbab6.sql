
-- Phase 2: 来店前日リマインド & 離脱客の自動復活ステップ

-- 1) profilesに配信トグル追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reactivation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_hour integer NOT NULL DEFAULT 19;

-- 2) 予約INSERT時に「前日19時のリマインド」ジョブを自動登録するトリガー
CREATE OR REPLACE FUNCTION public.schedule_reminder_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _enabled boolean;
  _hour integer;
  _scheduled timestamptz;
BEGIN
  -- 過去日や当日の予約はスキップ
  IF NEW.booking_date <= CURRENT_DATE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(reminder_enabled, true), COALESCE(reminder_hour, 19)
    INTO _enabled, _hour
    FROM public.profiles WHERE id = NEW.owner_id;

  IF NOT COALESCE(_enabled, true) THEN
    RETURN NEW;
  END IF;

  -- JSTを意識：DBはUTC前提なので、前日19:00 JST = 前日10:00 UTC
  _scheduled := ((NEW.booking_date - INTERVAL '1 day')::date + (_hour || ' hours')::interval) AT TIME ZONE 'Asia/Tokyo';

  -- 既に未来時刻でなければスキップ（直前予約）
  IF _scheduled <= now() THEN
    RETURN NEW;
  END IF;

  -- 同一予約に重複登録しない
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
$$;

DROP TRIGGER IF EXISTS trg_schedule_reminder ON public.bookings;
CREATE TRIGGER trg_schedule_reminder
AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.schedule_reminder_on_booking();

-- キャンセル時にリマインドを取り下げる
CREATE OR REPLACE FUNCTION public.cancel_reminder_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show') AND (OLD.status IS NULL OR OLD.status NOT IN ('cancelled','no_show')) THEN
    UPDATE public.scheduled_jobs
       SET status = 'cancelled', error = 'booking_' || NEW.status::text
     WHERE booking_id = NEW.id AND job_type = 'reminder' AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_reminder ON public.bookings;
CREATE TRIGGER trg_cancel_reminder
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.cancel_reminder_on_status_change();

-- 既存の status トリガー（thank_you登録）を再宣言（念のため）
DROP TRIGGER IF EXISTS trg_thank_you_on_complete ON public.bookings;
CREATE TRIGGER trg_thank_you_on_complete
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.schedule_thank_you_on_complete();

-- 3) 離脱客（90日以上未来店）に「復活クーポン」ジョブを作成するRPC
CREATE OR REPLACE FUNCTION public.create_reactivation_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count INTEGER := 0;
BEGIN
  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT
    c.owner_id, c.id, 'reactivation', now(),
    jsonb_build_object('days_since', (CURRENT_DATE - c.last_visit_date))
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.last_visit_date IS NOT NULL
    AND c.last_visit_date BETWEEN CURRENT_DATE - INTERVAL '120 days' AND CURRENT_DATE - INTERVAL '90 days'
    AND COALESCE(p.reactivation_enabled, true) = true
    AND COALESCE(c.is_test, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
       WHERE j.customer_id = c.id
         AND j.job_type = 'reactivation'
         AND j.created_at > now() - INTERVAL '180 days'
    );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

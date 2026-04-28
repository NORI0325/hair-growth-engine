
-- 1. クリック追跡用カラム（campaign_sends には既に clicked_at, booked_at がある）
-- 売上換算用：bookings に金額を持たせる（任意入力）
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS revenue INTEGER DEFAULT 0;

-- 2. VIPランクを計算する関数
CREATE OR REPLACE FUNCTION public.calculate_vip_tier(_visit_count INTEGER, _total_spent INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _total_spent >= 300000 OR _visit_count >= 30 THEN 'platinum'
    WHEN _total_spent >= 150000 OR _visit_count >= 15 THEN 'gold'
    WHEN _total_spent >= 50000 OR _visit_count >= 5 THEN 'silver'
    ELSE 'bronze'
  END
$$;

-- 3. 誕生月クーポンジョブを毎月1日に一括作成する関数
CREATE OR REPLACE FUNCTION public.create_birthday_jobs_for_month()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count INTEGER := 0;
BEGIN
  INSERT INTO public.scheduled_jobs (owner_id, customer_id, job_type, scheduled_for, payload)
  SELECT
    c.owner_id,
    c.id,
    'birthday',
    now(),
    jsonb_build_object('month', EXTRACT(MONTH FROM CURRENT_DATE))
  FROM public.customers c
  WHERE c.birthday IS NOT NULL
    AND EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM CURRENT_DATE)
    -- 同月に二重登録しない
    AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs j
      WHERE j.customer_id = c.id
        AND j.job_type = 'birthday'
        AND date_trunc('month', j.created_at) = date_trunc('month', CURRENT_DATE)
    );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_birthday_jobs_for_month() FROM PUBLIC, anon, authenticated;

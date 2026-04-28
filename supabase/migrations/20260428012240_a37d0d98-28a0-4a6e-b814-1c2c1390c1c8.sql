
-- 1. profiles に公開用スラッグとメニュー設定を追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS public_menus TEXT[] DEFAULT ARRAY['カット','カット＋カラー','カット＋パーマ','縮毛矯正','ヘッドスパ','その他']::TEXT[],
  ADD COLUMN IF NOT EXISTS open_time TIME DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS close_time TIME DEFAULT '19:00';

-- 既存のサロンにスラッグを自動付与
UPDATE public.profiles
SET public_slug = 'salon-' || substr(replace(id::text, '-', ''), 1, 10)
WHERE public_slug IS NULL;

-- スラッグ自動生成の関数
CREATE OR REPLACE FUNCTION public.ensure_public_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.public_slug IS NULL THEN
    NEW.public_slug := 'salon-' || substr(replace(NEW.id::text, '-', ''), 1, 10);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_ensure_slug ON public.profiles;
CREATE TRIGGER profiles_ensure_slug
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_public_slug();

-- 公開閲覧ポリシー（公開ページ用に salon_name, public_slug, public_menus, open/close を見せる）
DROP POLICY IF EXISTS "public salon page read" ON public.profiles;
CREATE POLICY "public salon page read"
  ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (public_slug IS NOT NULL);

-- 2. 公開新規登録 + 予約 を行うセキュアな関数（anon でも呼び出し可）
CREATE OR REPLACE FUNCTION public.public_create_booking(
  _salon_slug TEXT,
  _full_name TEXT,
  _phone TEXT,
  _email TEXT,
  _booking_date DATE,
  _booking_time TIME,
  _menu TEXT,
  _notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_id UUID;
  _customer_id UUID;
  _booking_id UUID;
BEGIN
  -- 入力検証
  IF _full_name IS NULL OR length(trim(_full_name)) < 1 OR length(_full_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name');
  END IF;
  IF _phone IS NULL OR length(trim(_phone)) < 8 OR length(_phone) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone');
  END IF;
  IF _booking_date IS NULL OR _booking_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_date');
  END IF;
  IF _menu IS NULL OR length(_menu) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_menu');
  END IF;

  -- サロン特定
  SELECT id INTO _owner_id FROM public.profiles WHERE public_slug = _salon_slug;
  IF _owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'salon_not_found');
  END IF;

  -- 既存顧客チェック（電話番号が一致したら使い回し）
  SELECT id INTO _customer_id
  FROM public.customers
  WHERE owner_id = _owner_id AND phone = _phone
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO public.customers (owner_id, full_name, phone, email)
    VALUES (_owner_id, trim(_full_name), trim(_phone), NULLIF(trim(_email), ''))
    RETURNING id INTO _customer_id;
  END IF;

  -- 予約作成
  INSERT INTO public.bookings (owner_id, customer_id, booking_date, booking_time, menu, notes, status)
  VALUES (_owner_id, _customer_id, _booking_date, _booking_time, _menu, NULLIF(trim(_notes), ''), 'pending')
  RETURNING id INTO _booking_id;

  RETURN jsonb_build_object('success', true, 'booking_id', _booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.public_create_booking(TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_booking(TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT) TO anon, authenticated;

-- 3. サンクスメール自動配信用ジョブテーブル
CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  booking_id UUID,
  job_type TEXT NOT NULL, -- 'thank_you'
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | cancelled
  payload JSONB DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_due ON public.scheduled_jobs(status, scheduled_for);

ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner jobs read" ON public.scheduled_jobs;
CREATE POLICY "owner jobs read" ON public.scheduled_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

-- 来店済みになったら自動でサンクスジョブを24時間後にスケジュール
CREATE OR REPLACE FUNCTION public.schedule_thank_you_on_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    -- 顧客の最終来店日と来店回数を更新
    UPDATE public.customers
       SET last_visit_date = NEW.booking_date,
           visit_count = visit_count + 1
     WHERE id = NEW.customer_id;

    -- 24時間後にサンクスメールジョブを登録
    INSERT INTO public.scheduled_jobs (owner_id, customer_id, booking_id, job_type, scheduled_for, payload)
    VALUES (
      NEW.owner_id,
      NEW.customer_id,
      NEW.id,
      'thank_you',
      now() + interval '24 hours',
      jsonb_build_object('menu', NEW.menu, 'booking_date', NEW.booking_date)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_thank_you_trigger ON public.bookings;
CREATE TRIGGER bookings_thank_you_trigger
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.schedule_thank_you_on_complete();

-- 1. profiles に受信用キーを追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS inbound_key TEXT UNIQUE;

-- 既存ユーザーにランダムキー付与
UPDATE public.profiles
   SET inbound_key = 'sb-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
 WHERE inbound_key IS NULL;

-- 新規ユーザー用のデフォルト
ALTER TABLE public.profiles
  ALTER COLUMN inbound_key SET DEFAULT ('sb-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

-- 2. bookings に外部連携カラム追加
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS external_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_reservation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_external_unique
  ON public.bookings (owner_id, external_source, external_reservation_id)
  WHERE external_reservation_id IS NOT NULL;

-- 3. 外部予約取り込みログテーブル
CREATE TABLE IF NOT EXISTS public.external_reservation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID,
  source TEXT NOT NULL,
  raw_to TEXT,
  raw_from TEXT,
  raw_subject TEXT,
  raw_text TEXT,
  parsed_data JSONB,
  status TEXT NOT NULL DEFAULT 'received',
  matched_customer_id UUID,
  created_booking_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ext_logs_owner ON public.external_reservation_logs (owner_id, created_at DESC);

ALTER TABLE public.external_reservation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner ext logs read" ON public.external_reservation_logs;
CREATE POLICY "owner ext logs read"
  ON public.external_reservation_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);
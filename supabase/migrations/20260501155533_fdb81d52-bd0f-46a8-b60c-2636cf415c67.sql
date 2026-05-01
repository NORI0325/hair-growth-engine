-- 拡張機能ダウンロード履歴（監査ログ）
CREATE TABLE public.extension_download_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  ip text,
  user_agent text,
  version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.extension_download_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners read own download logs"
ON public.extension_download_logs FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'super_admin'::app_role));

-- サロンボード取込履歴（監査ログ）
CREATE TABLE public.salonboard_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  location_id uuid,
  source text NOT NULL DEFAULT 'salonboard',
  total_received integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  reservations_received integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.salonboard_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant import logs read"
ON public.salonboard_import_logs FOR SELECT TO authenticated
USING (is_tenant_member(owner_id, auth.uid()));

CREATE INDEX idx_sb_import_logs_owner ON public.salonboard_import_logs(owner_id, created_at DESC);
CREATE INDEX idx_ext_dl_logs_user ON public.extension_download_logs(user_id, created_at DESC);

-- customers にサロンボード由来の識別子を追加（重複防止用）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS salonboard_customer_id text,
  ADD COLUMN IF NOT EXISTS salonboard_customer_no text,
  ADD COLUMN IF NOT EXISTS imported_from text,
  ADD COLUMN IF NOT EXISTS last_imported_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_customers_sb_id
  ON public.customers(owner_id, salonboard_customer_id)
  WHERE salonboard_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_phone_owner
  ON public.customers(owner_id, phone)
  WHERE phone IS NOT NULL;
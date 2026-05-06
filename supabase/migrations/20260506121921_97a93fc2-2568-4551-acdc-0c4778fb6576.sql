
-- ログテーブル
CREATE TABLE public.line_registration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  customer_id uuid,
  line_user_id text,
  phone_masked text,
  action text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  error_code text,
  error_message text,
  raw_event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_reg_logs_owner_created ON public.line_registration_logs(owner_id, created_at DESC);
CREATE INDEX idx_line_reg_logs_line_user ON public.line_registration_logs(line_user_id);

ALTER TABLE public.line_registration_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners can view own line registration logs"
  ON public.line_registration_logs FOR SELECT
  USING (owner_id = auth.uid());

-- DB側で電話番号を数字だけにして比較
CREATE OR REPLACE FUNCTION public.find_customer_by_normalized_phone(
  p_owner_id uuid,
  p_phone text
)
RETURNS TABLE (
  id uuid,
  full_name text,
  phone text,
  line_user_id text,
  location_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.full_name, c.phone, c.line_user_id, c.location_id
  FROM public.customers c
  WHERE c.owner_id = p_owner_id
    AND c.phone IS NOT NULL
    AND c.phone <> ''
    AND regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')
    AND length(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')) >= 10;
$$;

-- デフォルト店舗解決（is_primary 優先）
CREATE OR REPLACE FUNCTION public.default_location_for_owner(p_owner_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM public.locations l
  WHERE l.tenant_id = p_owner_id
  ORDER BY l.is_primary DESC NULLS LAST, l.created_at ASC
  LIMIT 1;
$$;

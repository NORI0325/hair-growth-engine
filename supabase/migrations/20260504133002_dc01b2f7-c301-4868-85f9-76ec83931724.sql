-- 顧客の「自動収集依頼」最終送信日時を記録（連投防止用）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS info_request_last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_request_pending JSONB DEFAULT NULL;
COMMENT ON COLUMN public.customers.info_request_last_sent_at IS 'LINEで未収集情報の依頼を送った最終日時（30分ウィンドウ判定にも使用）';
COMMENT ON COLUMN public.customers.info_request_pending IS '依頼中の未収集項目 例: {"birthday": true, "email": true} — 30分以内のbirthday回答を誕生日扱いするため';

-- profiles に「サンキューLINE末尾に未収集情報のお願いを同梱」設定
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS info_collection_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS info_collection_append_to_thanks BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN public.profiles.info_collection_enabled IS 'LINE経由の自動情報収集機能（誕生日・メアド等）の有効/無効';
COMMENT ON COLUMN public.profiles.info_collection_append_to_thanks IS 'サンキューLINE末尾に未収集項目のお願いを自動同梱するか';

-- 「自動検出ログ」（後から監査用）
CREATE TABLE IF NOT EXISTS public.line_field_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  customer_id UUID,
  line_user_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  detected JSONB NOT NULL,  -- 例: {"phone":"09012345678","email":"a@b.com","birthday":"05-12","name":"田中太郎"}
  applied JSONB NOT NULL,   -- 実際に反映した項目
  needs_confirmation BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.line_field_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant field_detections read"
  ON public.line_field_detections FOR SELECT
  TO authenticated
  USING (is_tenant_member(owner_id, auth.uid()));

CREATE INDEX IF NOT EXISTS idx_field_detections_owner_created
  ON public.line_field_detections(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_detections_customer
  ON public.line_field_detections(customer_id);
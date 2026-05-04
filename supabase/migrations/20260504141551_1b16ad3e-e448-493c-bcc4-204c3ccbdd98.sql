-- 予約仮受付ステータスEnum
DO $$ BEGIN
  CREATE TYPE public.reservation_request_status AS ENUM (
    'pending_clarification',
    'awaiting_approval',
    'approved',
    'rejected',
    'completed',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.reservation_requests (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  customer_id uuid,
  line_user_id text,
  display_name text,
  raw_message text NOT NULL,
  -- AI解析結果
  ai_model text,
  ai_confidence integer NOT NULL DEFAULT 0, -- 0-100
  ai_parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 希望
  desired_date_candidates jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{date,time_range,note}]
  desired_menu text,
  desired_menu_items text[],
  desired_staff_id uuid,
  desired_staff_name text,
  -- 確定情報（承認時に入る）
  confirmed_date date,
  confirmed_time time,
  confirmed_staff_id uuid,
  confirmed_menu text,
  -- ステータス管理
  status public.reservation_request_status NOT NULL DEFAULT 'awaiting_approval',
  needs_clarification_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  staff_memo text,
  rejection_reason text,
  -- 承認/操作履歴
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  -- サロンボード連携
  salonboard_transferred_at timestamptz,
  salonboard_transfer_text text,
  -- 営業時間外通知済みフラグ
  outside_hours_notified boolean NOT NULL DEFAULT false,
  -- 自動返信送信履歴
  auto_reply_sent_at timestamptz,
  -- メタ
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_requests_owner_status
  ON public.reservation_requests(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_requests_customer
  ON public.reservation_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservation_requests_line_user
  ON public.reservation_requests(line_user_id);

ALTER TABLE public.reservation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant rr read"
  ON public.reservation_requests FOR SELECT TO authenticated
  USING (is_tenant_member(owner_id, auth.uid()));

CREATE POLICY "tenant rr update"
  ON public.reservation_requests FOR UPDATE TO authenticated
  USING (is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (is_tenant_member(owner_id, auth.uid()));

CREATE POLICY "tenant rr insert"
  ON public.reservation_requests FOR INSERT TO authenticated
  WITH CHECK (is_tenant_member(owner_id, auth.uid()));

CREATE POLICY "manager rr delete"
  ON public.reservation_requests FOR DELETE TO authenticated
  USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_reservation_requests_updated
  BEFORE UPDATE ON public.reservation_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 設定カラムをprofilesに追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS line_reservation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_reservation_auto_reply text,
  ADD COLUMN IF NOT EXISTS line_reservation_outside_hours_reply text;
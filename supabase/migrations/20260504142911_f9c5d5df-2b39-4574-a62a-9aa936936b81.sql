
-- Phase 2: 信頼度学習ログテーブル
CREATE TABLE IF NOT EXISTS public.reservation_ai_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  request_id UUID REFERENCES public.reservation_requests(id) ON DELETE CASCADE,
  customer_id UUID,
  raw_message TEXT NOT NULL,
  keyword_score INTEGER,
  ai_is_reservation BOOLEAN,
  ai_confidence INTEGER,
  ai_summary TEXT,
  ai_extracted JSONB DEFAULT '{}'::jsonb,
  needs_clarification_fields TEXT[] DEFAULT '{}',
  -- 最終結果（スタッフ判断後に書き込まれる）
  final_action TEXT, -- 'approved' | 'proposed' | 'rejected' | 'no_action'
  final_corrected BOOLEAN DEFAULT false, -- スタッフがAI抽出を修正したか
  false_positive BOOLEAN DEFAULT false,  -- 予約じゃないのに予約と判定された
  staff_feedback TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  decided_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_reservation_ai_logs_owner_created
  ON public.reservation_ai_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_ai_logs_request
  ON public.reservation_ai_logs(request_id);

ALTER TABLE public.reservation_ai_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view ai logs"
ON public.reservation_ai_logs FOR SELECT
TO authenticated
USING (public.is_tenant_member(owner_id, auth.uid()));

CREATE POLICY "Service role can insert ai logs"
ON public.reservation_ai_logs FOR INSERT
TO authenticated, service_role
WITH CHECK (true);

CREATE POLICY "Tenant members can update ai logs"
ON public.reservation_ai_logs FOR UPDATE
TO authenticated
USING (public.is_tenant_member(owner_id, auth.uid()));

-- reservation_requests にスタッフ通知関連カラム追加
ALTER TABLE public.reservation_requests
  ADD COLUMN IF NOT EXISTS staff_notified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS staff_notification_status TEXT;

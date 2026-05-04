-- ワンタイムリンク承認用テーブル
CREATE TABLE public.reservation_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.reservation_requests(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('approve','propose','reject')),
  recipient_line_user_id text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_ip text,
  used_ua text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rat_request ON public.reservation_action_tokens(request_id);
CREATE INDEX idx_rat_hash ON public.reservation_action_tokens(token_hash);

ALTER TABLE public.reservation_action_tokens ENABLE ROW LEVEL SECURITY;

-- 一切の直接アクセスを禁止（Edge Function の service role 経由のみ）
CREATE POLICY "no_direct_access_select" ON public.reservation_action_tokens FOR SELECT USING (false);
CREATE POLICY "no_direct_access_insert" ON public.reservation_action_tokens FOR INSERT WITH CHECK (false);
CREATE POLICY "no_direct_access_update" ON public.reservation_action_tokens FOR UPDATE USING (false);
CREATE POLICY "no_direct_access_delete" ON public.reservation_action_tokens FOR DELETE USING (false);
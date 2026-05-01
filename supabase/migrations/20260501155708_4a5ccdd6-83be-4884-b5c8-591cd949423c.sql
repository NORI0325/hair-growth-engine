INSERT INTO storage.buckets (id, name, public)
VALUES ('private-extensions', 'private-extensions', false)
ON CONFLICT (id) DO NOTHING;

-- 一般ユーザーのアクセスは一切許可しない（service role のみ＝Edge Function経由のみ）
-- 既存のRLSデフォルトでブロックされるため policy 不要
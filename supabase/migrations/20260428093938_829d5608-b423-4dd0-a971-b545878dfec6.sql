-- 無効なLINE User ID（"U" + 32桁英数字 形式以外）をクリア
UPDATE public.customers
SET line_user_id = NULL
WHERE line_user_id IS NOT NULL
  AND line_user_id !~ '^U[0-9a-f]{32}$';
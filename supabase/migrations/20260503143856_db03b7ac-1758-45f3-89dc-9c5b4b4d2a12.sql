-- 拡張機能用：自分が所属している店舗のみを返すRPC（公開予約スラッグの店舗は除外）
CREATE OR REPLACE FUNCTION public.get_my_member_locations()
RETURNS TABLE (id uuid, name text, is_primary boolean, tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.id, l.name, l.is_primary, l.tenant_id
  FROM public.locations l
  WHERE EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = l.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.accepted_at IS NOT NULL
  )
  OR EXISTS (
    SELECT 1 FROM public.location_members lm
    WHERE lm.location_id = l.id
      AND lm.user_id = auth.uid()
  )
  ORDER BY is_primary DESC NULLS LAST, name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_member_locations() TO authenticated;
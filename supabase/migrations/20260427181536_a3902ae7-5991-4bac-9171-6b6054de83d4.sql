
-- search_path修正
ALTER FUNCTION public.calculate_segment(DATE) SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- 公開させたくないSECURITY DEFINER関数の権限剥奪
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_customer_token() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;

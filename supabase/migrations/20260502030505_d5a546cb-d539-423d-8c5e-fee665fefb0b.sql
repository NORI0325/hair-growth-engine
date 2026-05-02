
-- ビューを SECURITY INVOKER に
ALTER VIEW public.delivery_upcoming_view SET (security_invoker = true);
ALTER VIEW public.delivery_daily_summary SET (security_invoker = true);

-- 関数の anon 実行を禁止
REVOKE EXECUTE ON FUNCTION public.can_send_to_customer(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_customer_communication(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_to_customer(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_communication(uuid, uuid, uuid, text, text) TO service_role;

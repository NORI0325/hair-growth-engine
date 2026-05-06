
REVOKE EXECUTE ON FUNCTION public.find_customer_by_normalized_phone(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.default_location_for_owner(uuid) FROM anon, authenticated;

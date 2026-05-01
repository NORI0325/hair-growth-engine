REVOKE EXECUTE ON FUNCTION public.can_access_location(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_location(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_location(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_location(uuid, uuid) TO authenticated;
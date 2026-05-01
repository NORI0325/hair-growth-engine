REVOKE EXECUTE ON FUNCTION public.can_access_location(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_manage_location(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_location(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_location(uuid, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.can_access_location(_location_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.locations l
    LEFT JOIN public.tenant_members tm
      ON tm.tenant_id = l.tenant_id
     AND tm.user_id = _user_id
     AND tm.accepted_at IS NOT NULL
    LEFT JOIN public.location_members lm
      ON lm.location_id = l.id
     AND lm.user_id = _user_id
    WHERE l.id = _location_id
      AND (tm.user_id IS NOT NULL OR lm.user_id IS NOT NULL)
  )
$$;

REVOKE ALL ON FUNCTION public.can_access_location(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_location(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_access_location(uuid, uuid) FROM authenticated;
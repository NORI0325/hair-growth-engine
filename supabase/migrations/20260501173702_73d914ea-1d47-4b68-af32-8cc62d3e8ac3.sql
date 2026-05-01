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
      AND (tm.user_id IS NOT NULL OR lm.user_id IS NOT NULL OR l.public_slug IS NOT NULL)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_location(_location_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.locations l
    JOIN public.tenant_members tm
      ON tm.tenant_id = l.tenant_id
     AND tm.user_id = _user_id
     AND tm.accepted_at IS NOT NULL
    WHERE l.id = _location_id
      AND tm.role IN ('owner'::public.app_role, 'super_admin'::public.app_role)
  )
$$;

DROP POLICY IF EXISTS "tenant members read locations" ON public.locations;
CREATE POLICY "tenant members read locations"
ON public.locations
FOR SELECT
TO authenticated
USING (public.can_access_location(id, auth.uid()));

DROP POLICY IF EXISTS "owner manage location members" ON public.location_members;
CREATE POLICY "owner manage location members"
ON public.location_members
FOR ALL
TO authenticated
USING (public.can_manage_location(location_id, auth.uid()))
WITH CHECK (public.can_manage_location(location_id, auth.uid()));
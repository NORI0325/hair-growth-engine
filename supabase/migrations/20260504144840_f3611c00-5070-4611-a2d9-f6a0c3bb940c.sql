CREATE OR REPLACE FUNCTION public.get_tenant_members_detail(_tenant_id uuid)
RETURNS TABLE(user_id uuid, role app_role, accepted_at timestamp with time zone, full_name text, email text, location_ids uuid[], location_names text[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_tenant_role(_tenant_id, auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    tm.user_id,
    tm.role,
    tm.accepted_at,
    p.full_name,
    u.email::text,
    COALESCE(
      (SELECT array_agg(lm.location_id)
         FROM public.location_members lm
         JOIN public.locations l ON l.id = lm.location_id
        WHERE lm.user_id = tm.user_id AND l.tenant_id = _tenant_id),
      ARRAY[]::uuid[]
    ) AS location_ids,
    COALESCE(
      (SELECT array_agg(l.name ORDER BY l.name)
         FROM public.location_members lm
         JOIN public.locations l ON l.id = lm.location_id
        WHERE lm.user_id = tm.user_id AND l.tenant_id = _tenant_id),
      ARRAY[]::text[]
    ) AS location_names
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = _tenant_id
  ORDER BY tm.role DESC, p.full_name NULLS LAST;
END;
$function$;
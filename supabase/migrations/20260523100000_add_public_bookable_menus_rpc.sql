-- Public booking menu list RPC.
-- Keeps anonymous booking screens from reading private channel mapping tables
-- directly while returning only menus that the booking guards can accept.

CREATE OR REPLACE FUNCTION public.public_get_bookable_menus_v1(
  _owner_id uuid,
  _location_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  price integer,
  duration_minutes integer,
  buffer_minutes integer,
  image_url text,
  sort_order integer,
  location_id uuid,
  is_salonboard_syncable boolean,
  external_setmenu_id text,
  rsv_term integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _salonboard_live boolean := false;
BEGIN
  IF _owner_id IS NULL OR _location_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.channel_integrations ci
     WHERE ci.owner_id = _owner_id
       AND ci.location_id = _location_id
       AND ci.channel = 'salonboard'
       AND ci.enabled = true
       AND ci.sync_enabled = true
       AND ci.connection_status = 'live'
  ) INTO _salonboard_live;

  IF _salonboard_live THEN
    RETURN QUERY
    WITH guard_pass AS (
      SELECT
        mi.id,
        mi.name,
        mi.description,
        mi.price,
        mi.duration_minutes,
        mi.buffer_minutes,
        mi.image_url,
        mi.sort_order,
        mi.location_id,
        COALESCE(NULLIF(mcm.external_setmenu_id, ''), mcm.external_id) AS external_setmenu_id,
        mcm.rsv_term
      FROM public.menu_items mi
      JOIN public.menu_channel_mappings mcm
        ON mcm.menu_id = mi.id
       AND mcm.owner_id = mi.owner_id
       AND mcm.channel = 'salonboard'
       AND mcm.enabled = true
      JOIN public.channel_menu_options cmo
        ON cmo.owner_id = mi.owner_id
       AND cmo.location_id = mi.location_id
       AND cmo.channel = 'salonboard'
       AND cmo.source_type = 'setmenu'
       AND cmo.setmenu_id = COALESCE(NULLIF(mcm.external_setmenu_id, ''), mcm.external_id)
       AND cmo.rsv_term IS NOT NULL
     WHERE mi.owner_id = _owner_id
       AND mi.location_id = _location_id
       AND mi.active = true
       AND COALESCE(NULLIF(mcm.external_setmenu_id, ''), mcm.external_id) IS NOT NULL
       AND COALESCE(NULLIF(mcm.external_setmenu_id, ''), mcm.external_id) ~ '^SN'
       AND mcm.rsv_term IS NOT NULL
    )
    SELECT
      gp.id,
      gp.name,
      gp.description,
      gp.price,
      gp.duration_minutes,
      gp.buffer_minutes,
      gp.image_url,
      gp.sort_order,
      gp.location_id,
      true AS is_salonboard_syncable,
      gp.external_setmenu_id,
      gp.rsv_term
    FROM guard_pass gp
    WHERE (
      SELECT COUNT(*)
        FROM guard_pass gp_by_name
       WHERE gp_by_name.name = gp.name
    ) = 1
    ORDER BY gp.sort_order NULLS LAST, gp.name;

    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    mi.id,
    mi.name,
    mi.description,
    mi.price,
    mi.duration_minutes,
    mi.buffer_minutes,
    mi.image_url,
    mi.sort_order,
    mi.location_id,
    false AS is_salonboard_syncable,
    NULL::text AS external_setmenu_id,
    NULL::integer AS rsv_term
  FROM public.menu_items mi
  WHERE mi.owner_id = _owner_id
    AND mi.location_id = _location_id
    AND mi.active = true
  ORDER BY mi.sort_order NULLS LAST, mi.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_get_bookable_menus_v1(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_menus_v1(uuid, uuid) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.salon_parking_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  parking_status text NOT NULL DEFAULT 'unknown' CHECK (parking_status IN ('available','partner','none','unknown')),
  parking_spaces integer,
  parking_description text,
  parking_map_url text,
  parking_landmark text,
  parking_full_notice text,
  parking_fee_note text,
  parking_photo_url text,
  parking_reply_template text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS salon_parking_settings_owner_loc_uniq
  ON public.salon_parking_settings (owner_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.salon_parking_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant parking read" ON public.salon_parking_settings
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant parking write" ON public.salon_parking_settings
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant parking update" ON public.salon_parking_settings
  FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager parking delete" ON public.salon_parking_settings
  FOR DELETE TO authenticated USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE OR REPLACE FUNCTION public.set_updated_at_parking()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_parking_updated_at ON public.salon_parking_settings;
CREATE TRIGGER trg_parking_updated_at
  BEFORE UPDATE ON public.salon_parking_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_parking();
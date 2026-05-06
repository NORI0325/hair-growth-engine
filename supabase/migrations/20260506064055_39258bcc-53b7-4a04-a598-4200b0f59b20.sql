
-- 1) channel_staff_options
CREATE TABLE IF NOT EXISTS public.channel_staff_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  channel text NOT NULL DEFAULT 'salonboard',
  external_staff_id text NOT NULL,
  display_name text NOT NULL,
  is_no_designation boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cso_owner_loc_channel_ext
  ON public.channel_staff_options (owner_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, external_staff_id);
CREATE INDEX IF NOT EXISTS idx_cso_owner ON public.channel_staff_options (owner_id, channel);

ALTER TABLE public.channel_staff_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant cso read" ON public.channel_staff_options
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cso write" ON public.channel_staff_options
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cso update" ON public.channel_staff_options
  FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cso delete" ON public.channel_staff_options
  FOR DELETE TO authenticated USING (is_tenant_member(owner_id, auth.uid()));

CREATE TRIGGER trg_cso_updated_at BEFORE UPDATE ON public.channel_staff_options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) channel_menu_options
CREATE TABLE IF NOT EXISTS public.channel_menu_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  channel text NOT NULL DEFAULT 'salonboard',
  external_menu_id text NOT NULL,
  setmenu_id text,
  menu_id text,
  menu_category_cd text,
  menu_name text NOT NULL,
  rsv_term integer,
  price integer,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmo_owner_loc_channel_ext
  ON public.channel_menu_options (owner_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, external_menu_id);
CREATE INDEX IF NOT EXISTS idx_cmo_owner ON public.channel_menu_options (owner_id, channel);

ALTER TABLE public.channel_menu_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant cmo read" ON public.channel_menu_options
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cmo write" ON public.channel_menu_options
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cmo update" ON public.channel_menu_options
  FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cmo delete" ON public.channel_menu_options
  FOR DELETE TO authenticated USING (is_tenant_member(owner_id, auth.uid()));

CREATE TRIGGER trg_cmo_updated_at BEFORE UPDATE ON public.channel_menu_options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) staff_channel_mappings に指名なしフラグ追加
ALTER TABLE public.staff_channel_mappings
  ADD COLUMN IF NOT EXISTS is_no_designation boolean NOT NULL DEFAULT false;

-- 4) menu_channel_mappings に menu_category_cd 追加（不足分のみ）
ALTER TABLE public.menu_channel_mappings
  ADD COLUMN IF NOT EXISTS menu_category_cd text;

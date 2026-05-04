
CREATE TABLE public.customer_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#C5A572',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
ALTER TABLE public.customer_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant tags read" ON public.customer_tags FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant tags write" ON public.customer_tags FOR ALL TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));

CREATE TABLE public.customer_tag_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, tag_id)
);
CREATE INDEX idx_cta_customer ON public.customer_tag_assignments(customer_id);
CREATE INDEX idx_cta_tag ON public.customer_tag_assignments(tag_id);
ALTER TABLE public.customer_tag_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant cta read" ON public.customer_tag_assignments FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant cta write" ON public.customer_tag_assignments FOR ALL TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));

CREATE TABLE public.broadcast_segments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  location_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.broadcast_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant seg read" ON public.broadcast_segments FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant seg write" ON public.broadcast_segments FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_customer_tags_updated_at BEFORE UPDATE ON public.customer_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_broadcast_segments_updated_at BEFORE UPDATE ON public.broadcast_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

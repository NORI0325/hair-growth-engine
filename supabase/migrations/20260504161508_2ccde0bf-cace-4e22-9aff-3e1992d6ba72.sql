
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source_channel TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS sync_error_message TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN NOT NULL DEFAULT false;

UPDATE public.bookings
   SET source_channel = CASE
        WHEN external_source IN ('hotpepper','salonboard','hpb') THEN 'salonboard'
        WHEN external_source = 'rakuten' THEN 'rakuten_beauty'
        WHEN external_source IN ('line','line_reservation') THEN 'line_reservation'
        WHEN external_source IN ('google','google_reservation') THEN 'google_reservation'
        WHEN external_source = 'own_web' THEN 'own_web'
        WHEN external_source = 'phone' THEN 'phone'
        ELSE 'manual'
       END
 WHERE source_channel IS NULL;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_source_channel_check
  CHECK (source_channel IN ('salonboard','rakuten_beauty','line_reservation','google_reservation','own_web','phone','manual'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_sync_status_check
  CHECK (sync_status IN ('not_required','pending','syncing','success','failed','needs_review'));

CREATE INDEX IF NOT EXISTS idx_bookings_sync_review
  ON public.bookings (owner_id, sync_status)
  WHERE sync_status IN ('failed','needs_review');

CREATE TABLE IF NOT EXISTS public.channel_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  channel TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  sync_enabled BOOLEAN NOT NULL DEFAULT false,
  last_synced_at TIMESTAMPTZ,
  last_status TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT channel_integrations_channel_check CHECK (channel IN ('salonboard','rakuten_beauty','line_reservation','google_reservation','own_web','phone'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_integrations
  ON public.channel_integrations (owner_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);
ALTER TABLE public.channel_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant ci read" ON public.channel_integrations FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant ci write" ON public.channel_integrations FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant ci update" ON public.channel_integrations FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant ci delete" ON public.channel_integrations FOR DELETE TO authenticated USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));
CREATE TRIGGER trg_ci_updated_at BEFORE UPDATE ON public.channel_integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  reservation_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  target_channel TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  request_payload JSONB,
  response_payload JSONB,
  error_type TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_jobs_status_check CHECK (status IN ('pending','processing','success','failed','needs_review','cancelled')),
  CONSTRAINT sync_jobs_jobtype_check CHECK (job_type IN ('create_reservation','update_reservation','cancel_reservation','create_availability_block','delete_availability_block')),
  CONSTRAINT sync_jobs_channel_check CHECK (target_channel IN ('salonboard','rakuten_beauty','line_reservation','google_reservation','own_web','phone'))
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_owner_status ON public.sync_jobs (owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_reservation ON public.sync_jobs (reservation_id);
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant sj read" ON public.sync_jobs FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant sj write" ON public.sync_jobs FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant sj update" ON public.sync_jobs FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE TRIGGER trg_sync_jobs_updated_at BEFORE UPDATE ON public.sync_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  sync_job_id UUID REFERENCES public.sync_jobs(id) ON DELETE CASCADE,
  reservation_id UUID,
  channel TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sync_logs_level_check CHECK (level IN ('info','warning','error'))
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_owner_created ON public.sync_logs (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_job ON public.sync_logs (sync_job_id);
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant sl read" ON public.sync_logs FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant sl write" ON public.sync_logs FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.staff_channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_name TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scm_channel_check CHECK (channel IN ('salonboard','rakuten_beauty','line_reservation','google_reservation','own_web','phone')),
  UNIQUE (staff_id, channel)
);
ALTER TABLE public.staff_channel_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant scm read" ON public.staff_channel_mappings FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant scm write" ON public.staff_channel_mappings FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant scm update" ON public.staff_channel_mappings FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant scm delete" ON public.staff_channel_mappings FOR DELETE TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE TRIGGER trg_scm_updated_at BEFORE UPDATE ON public.staff_channel_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.menu_channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  menu_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_name TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcm_channel_check CHECK (channel IN ('salonboard','rakuten_beauty','line_reservation','google_reservation','own_web','phone')),
  UNIQUE (menu_id, channel)
);
ALTER TABLE public.menu_channel_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant mcm read" ON public.menu_channel_mappings FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant mcm write" ON public.menu_channel_mappings FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant mcm update" ON public.menu_channel_mappings FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant mcm delete" ON public.menu_channel_mappings FOR DELETE TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE TRIGGER trg_mcm_updated_at BEFORE UPDATE ON public.menu_channel_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

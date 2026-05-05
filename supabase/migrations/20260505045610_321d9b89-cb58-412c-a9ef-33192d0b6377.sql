CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.salonboard_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  login_id_encrypted TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  cookie_session_encrypted TEXT,
  last_login_at TIMESTAMPTZ,
  login_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.salonboard_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage salonboard credentials"
ON public.salonboard_credentials FOR ALL
USING (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.owner_user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.owner_user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.salonboard_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reservation_id UUID,
  operation TEXT NOT NULL CHECK (operation IN ('create','update','cancel')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed','needs_review')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  salonboard_reservation_id TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.salonboard_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view salonboard sync jobs"
ON public.salonboard_sync_jobs FOR SELECT
USING (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.owner_user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_sb_sync_jobs_status ON public.salonboard_sync_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sb_sync_jobs_tenant ON public.salonboard_sync_jobs(tenant_id);

CREATE TRIGGER update_sb_credentials_updated_at
BEFORE UPDATE ON public.salonboard_credentials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_sb_sync_jobs_updated_at
BEFORE UPDATE ON public.salonboard_sync_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
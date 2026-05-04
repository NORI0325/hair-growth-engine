CREATE TABLE public.extension_download_consents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID,
  terms_version TEXT NOT NULL,
  consent_unofficial BOOLEAN NOT NULL DEFAULT false,
  consent_risk_self_responsibility BOOLEAN NOT NULL DEFAULT false,
  consent_proper_use BOOLEAN NOT NULL DEFAULT false,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_extension_consents_user ON public.extension_download_consents(user_id, created_at DESC);

ALTER TABLE public.extension_download_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own consents"
ON public.extension_download_consents
FOR SELECT
USING (auth.uid() = user_id);

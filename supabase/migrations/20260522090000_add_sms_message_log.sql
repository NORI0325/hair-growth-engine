-- SMS delivery audit log.
-- Applied by Lovable/Supabase migration flow only; this file is not applied by Codex.

CREATE TABLE IF NOT EXISTS public.sms_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  customer_id uuid,
  phone text NOT NULL,
  normalized_phone text,
  message text NOT NULL,
  source text NOT NULL CHECK (source IN ('send_campaign', 'bulk_broadcast', 'scheduled_job', 'sms_test')),
  job_type text,
  campaign_id uuid,
  scheduled_job_id uuid,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  provider text NOT NULL DEFAULT 'twilio',
  provider_sid text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_message_log_owner_created
  ON public.sms_message_log (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_message_log_customer_created
  ON public.sms_message_log (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_message_log_campaign
  ON public.sms_message_log (campaign_id);

CREATE INDEX IF NOT EXISTS idx_sms_message_log_scheduled_job
  ON public.sms_message_log (scheduled_job_id);

ALTER TABLE public.sms_message_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant sms log read" ON public.sms_message_log;
CREATE POLICY "tenant sms log read"
  ON public.sms_message_log
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));

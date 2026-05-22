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

CREATE OR REPLACE VIEW public.customer_delivery_timeline
WITH (security_invoker = true)
AS
SELECT
  esl.id::text AS id,
  (esl.metadata->>'owner_id')::uuid AS owner_id,
  (esl.metadata->>'customer_id')::uuid AS customer_id,
  'email'::text AS channel,
  esl.template_name AS template_key,
  esl.status,
  esl.recipient_email AS recipient,
  esl.error_message AS error,
  esl.created_at AS sent_at
FROM public.email_send_log esl
WHERE esl.metadata ? 'customer_id'
UNION ALL
SELECT
  lml.id::text AS id,
  lml.owner_id,
  lml.customer_id,
  'line'::text AS channel,
  COALESCE(lml.template_key, lml.job_type) AS template_key,
  lml.status,
  lml.line_user_id AS recipient,
  lml.error,
  lml.created_at AS sent_at
FROM public.line_message_log lml
WHERE lml.customer_id IS NOT NULL
UNION ALL
SELECT
  sml.id::text AS id,
  sml.owner_id,
  sml.customer_id,
  'sms'::text AS channel,
  COALESCE(sml.job_type, sml.source) AS template_key,
  sml.status,
  COALESCE(sml.normalized_phone, sml.phone) AS recipient,
  sml.error,
  COALESCE(sml.sent_at, sml.created_at) AS sent_at
FROM public.sms_message_log sml
WHERE sml.customer_id IS NOT NULL;

GRANT SELECT ON public.customer_delivery_timeline TO authenticated;
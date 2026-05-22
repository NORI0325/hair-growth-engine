-- Include SMS audit logs in the customer delivery timeline view.
-- Applied by Lovable/Supabase migration flow only; this file is not applied by Codex.

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

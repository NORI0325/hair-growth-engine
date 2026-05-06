CREATE TABLE IF NOT EXISTS public.worker_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  channel text NOT NULL DEFAULT 'salonboard',
  kind text NOT NULL,
  request_payload jsonb,
  response_status integer,
  response_body jsonb,
  latency_ms integer,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_request_logs_owner ON public.worker_request_logs(owner_id, created_at DESC);

ALTER TABLE public.worker_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant worker logs read"
ON public.worker_request_logs
FOR SELECT
TO authenticated
USING (is_tenant_member(owner_id, auth.uid()));
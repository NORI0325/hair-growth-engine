
ALTER TABLE public.external_reservation_logs
  ADD COLUMN IF NOT EXISTS inbound_message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_logs_idem
  ON public.external_reservation_logs (owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ext_logs_needs_review
  ON public.external_reservation_logs (owner_id, created_at DESC)
  WHERE status = 'needs_review';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_source TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

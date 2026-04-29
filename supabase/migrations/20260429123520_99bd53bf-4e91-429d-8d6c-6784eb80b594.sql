CREATE TABLE public.line_inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  customer_id UUID,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  message_text TEXT NOT NULL,
  intent TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal',
  summary TEXT,
  suggested_action TEXT,
  ai_processed BOOLEAN NOT NULL DEFAULT false,
  ai_error TEXT,
  handled BOOLEAN NOT NULL DEFAULT false,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_inbound_owner_created ON public.line_inbound_messages(owner_id, created_at DESC);
CREATE INDEX idx_line_inbound_unhandled ON public.line_inbound_messages(owner_id, handled, urgency) WHERE handled = false;

ALTER TABLE public.line_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner inbound read" ON public.line_inbound_messages
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "owner inbound update" ON public.line_inbound_messages
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
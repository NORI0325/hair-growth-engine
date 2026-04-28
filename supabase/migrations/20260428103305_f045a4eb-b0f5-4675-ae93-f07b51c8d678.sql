CREATE TABLE public.template_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','line')),
  template_key TEXT NOT NULL,
  subject TEXT,
  greeting TEXT,
  body TEXT,
  cta_label TEXT,
  cta_url TEXT,
  signature TEXT,
  coupon_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, channel, template_key)
);
ALTER TABLE public.template_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner template_overrides all" ON public.template_overrides FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_template_overrides_updated_at BEFORE UPDATE ON public.template_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_template_overrides_lookup ON public.template_overrides(owner_id, channel, template_key);

CREATE TABLE public.line_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  cta_label TEXT,
  cta_url TEXT,
  category TEXT DEFAULT 'general',
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.line_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner line_templates all" ON public.line_templates FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER trg_line_templates_updated_at BEFORE UPDATE ON public.line_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.line_message_log
  ADD COLUMN IF NOT EXISTS broadcast_id UUID,
  ADD COLUMN IF NOT EXISTS template_key TEXT;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source_template TEXT,
  ADD COLUMN IF NOT EXISTS source_job_id UUID;
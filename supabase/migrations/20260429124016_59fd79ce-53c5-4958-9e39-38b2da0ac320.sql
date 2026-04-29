-- Phase 3
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_reply_message TEXT,
  ADD COLUMN IF NOT EXISTS auto_reply_use_ai BOOLEAN NOT NULL DEFAULT true;

-- Phase 4
CREATE TABLE IF NOT EXISTS public.customer_ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  customer_id UUID NOT NULL UNIQUE,
  summary TEXT,
  recommendations JSONB DEFAULT '[]'::jsonb,
  risks JSONB DEFAULT '[]'::jsonb,
  next_visit_suggestion TEXT,
  preferred_tone TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_ai_insights_owner ON public.customer_ai_insights(owner_id);

ALTER TABLE public.customer_ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner insights read" ON public.customer_ai_insights
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "owner insights upsert" ON public.customer_ai_insights
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "owner insights update" ON public.customer_ai_insights
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "owner insights delete" ON public.customer_ai_insights
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);
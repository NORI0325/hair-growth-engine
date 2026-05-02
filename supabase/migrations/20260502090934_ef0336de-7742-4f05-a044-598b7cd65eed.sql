CREATE TABLE public.help_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  related_routes TEXT[] DEFAULT ARRAY[]::TEXT[],
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  sort_order INTEGER NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read published help" ON public.help_articles FOR SELECT TO anon, authenticated USING (published = true);
CREATE POLICY "super_admin manage help" ON public.help_articles FOR ALL TO authenticated USING (has_role(auth.uid(), 'super_admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
CREATE INDEX idx_help_articles_category ON public.help_articles(category, sort_order);
CREATE INDEX idx_help_articles_routes ON public.help_articles USING GIN(related_routes);
CREATE TRIGGER tr_help_articles_updated BEFORE UPDATE ON public.help_articles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  context_route TEXT,
  context_data JSONB,
  ai_chat_history JSONB,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant own tickets read" ON public.support_tickets FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()) OR has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "tenant insert tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()) AND user_id = auth.uid());
CREATE TRIGGER tr_support_tickets_updated BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.support_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  context_route TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.support_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own chat read" ON public.support_chat_messages FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user own chat insert" ON public.support_chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_support_chat_session ON public.support_chat_messages(session_id, created_at);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tour_completed BOOLEAN NOT NULL DEFAULT false;
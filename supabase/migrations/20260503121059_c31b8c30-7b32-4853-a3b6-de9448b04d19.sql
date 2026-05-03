
-- 1. customer_line_link_tokens
CREATE TABLE public.customer_line_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  token text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX idx_clt_owner ON public.customer_line_link_tokens(owner_id);
CREATE INDEX idx_clt_customer ON public.customer_line_link_tokens(customer_id);

ALTER TABLE public.customer_line_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant link tokens read" ON public.customer_line_link_tokens
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));

CREATE POLICY "tenant link tokens write" ON public.customer_line_link_tokens
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));

CREATE POLICY "tenant link tokens delete" ON public.customer_line_link_tokens
  FOR DELETE TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));

-- 2. customers.line_unfollowed_at
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS line_unfollowed_at timestamptz;

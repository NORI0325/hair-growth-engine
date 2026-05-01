
-- ============================================================
-- 1. New tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  owner_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'trialing',
  plan TEXT NOT NULL DEFAULT 'standard',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON public.tenant_members(user_id);

CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email TEXT NOT NULL,
  role public.app_role NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  invited_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.tenant_invitations(email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON public.tenant_invitations(tenant_id);

CREATE TABLE IF NOT EXISTS public.tenant_usage_counters (
  owner_id UUID NOT NULL,
  period_start DATE NOT NULL,
  emails_sent INT NOT NULL DEFAULT 0,
  sms_sent INT NOT NULL DEFAULT 0,
  line_sent INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, period_start)
);
ALTER TABLE public.tenant_usage_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB NOT NULL DEFAULT '{"basic":false,"menus":false,"staff":false,"line":false,"share":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- ============================================================
-- 2. Backfill existing owners
-- ============================================================
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
SELECT id, id, 'owner'::public.app_role, now() FROM public.profiles
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO public.subscriptions (owner_id, status, plan, trial_ends_at)
SELECT id, 'active', 'standard', now() + INTERVAL '10 years'
FROM public.profiles
ON CONFLICT (owner_id) DO NOTHING;

-- ============================================================
-- 3. Helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id AND user_id = _user_id AND accepted_at IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id UUID, _user_id UUID, _min_role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id AND user_id = _user_id AND accepted_at IS NOT NULL
      AND CASE _min_role
        WHEN 'staff'::public.app_role       THEN role IN ('staff'::public.app_role,'manager'::public.app_role,'owner'::public.app_role,'super_admin'::public.app_role)
        WHEN 'manager'::public.app_role     THEN role IN ('manager'::public.app_role,'owner'::public.app_role,'super_admin'::public.app_role)
        WHEN 'owner'::public.app_role       THEN role IN ('owner'::public.app_role,'super_admin'::public.app_role)
        WHEN 'super_admin'::public.app_role THEN role = 'super_admin'::public.app_role
        ELSE false
      END
  )
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
   WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
   ORDER BY (role = 'owner'::public.app_role) DESC, accepted_at ASC
   LIMIT 1
$$;

-- ============================================================
-- 4. RLS on new tables
-- ============================================================
DROP POLICY IF EXISTS "tenant subs read" ON public.subscriptions;
CREATE POLICY "tenant subs read" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

DROP POLICY IF EXISTS "members read same tenant" ON public.tenant_members;
CREATE POLICY "members read same tenant" ON public.tenant_members
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS "owner manage members" ON public.tenant_members;
CREATE POLICY "owner manage members" ON public.tenant_members
  FOR ALL TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), 'owner'::public.app_role))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), 'owner'::public.app_role));

DROP POLICY IF EXISTS "owner manage invitations" ON public.tenant_invitations;
CREATE POLICY "owner manage invitations" ON public.tenant_invitations
  FOR ALL TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), 'owner'::public.app_role))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), 'owner'::public.app_role));

DROP POLICY IF EXISTS "invitee read own invitations" ON public.tenant_invitations;
CREATE POLICY "invitee read own invitations" ON public.tenant_invitations
  FOR SELECT TO authenticated
  USING (lower(email) = lower(COALESCE((auth.jwt() ->> 'email')::text, '')));

DROP POLICY IF EXISTS "tenant usage read" ON public.tenant_usage_counters;
CREATE POLICY "tenant usage read" ON public.tenant_usage_counters
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()));

-- ============================================================
-- 5. Update existing tables' RLS
-- ============================================================

-- bookings
DROP POLICY IF EXISTS "owner bookings all" ON public.bookings;
CREATE POLICY "tenant bookings read" ON public.bookings
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant bookings write" ON public.bookings
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant bookings update" ON public.bookings
  FOR UPDATE TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager bookings delete" ON public.bookings
  FOR DELETE TO authenticated USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- customers
DROP POLICY IF EXISTS "owner customers all" ON public.customers;
CREATE POLICY "tenant customers read" ON public.customers
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant customers write" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant customers update" ON public.customers
  FOR UPDATE TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager customers delete" ON public.customers
  FOR DELETE TO authenticated USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- coupons
DROP POLICY IF EXISTS "owner coupons all" ON public.coupons;
CREATE POLICY "tenant coupons read" ON public.coupons
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager coupons write" ON public.coupons
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- incentives
DROP POLICY IF EXISTS "owner incentives all" ON public.incentives;
CREATE POLICY "tenant incentives read" ON public.incentives
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager incentives write" ON public.incentives
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- staff
DROP POLICY IF EXISTS "owner staff all" ON public.staff;
CREATE POLICY "tenant staff read" ON public.staff
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager staff write" ON public.staff
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- staff_schedules
DROP POLICY IF EXISTS "owner staff_schedules all" ON public.staff_schedules;
CREATE POLICY "tenant schedules read" ON public.staff_schedules
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager schedules write" ON public.staff_schedules
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- staff_time_off
DROP POLICY IF EXISTS "owner staff_time_off all" ON public.staff_time_off;
CREATE POLICY "tenant time_off all" ON public.staff_time_off
  FOR ALL TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));

-- salon_hours
DROP POLICY IF EXISTS "owner salon_hours all" ON public.salon_hours;
CREATE POLICY "tenant hours read auth" ON public.salon_hours
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager hours write" ON public.salon_hours
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- menu_items
DROP POLICY IF EXISTS "owner menu_items all" ON public.menu_items;
CREATE POLICY "tenant menu read" ON public.menu_items
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager menu write" ON public.menu_items
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- customer_message_templates
DROP POLICY IF EXISTS "owner customer_message_templates all" ON public.customer_message_templates;
CREATE POLICY "tenant cmt all" ON public.customer_message_templates
  FOR ALL TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));

-- template_overrides
DROP POLICY IF EXISTS "owner template_overrides all" ON public.template_overrides;
CREATE POLICY "tenant overrides all" ON public.template_overrides
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- line_templates
DROP POLICY IF EXISTS "owner line_templates all" ON public.line_templates;
CREATE POLICY "tenant line_tpl all" ON public.line_templates
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- campaigns
DROP POLICY IF EXISTS "owner campaigns all" ON public.campaigns;
CREATE POLICY "tenant campaigns all" ON public.campaigns
  FOR ALL TO authenticated
  USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- customer_ai_insights
DROP POLICY IF EXISTS "owner insights read" ON public.customer_ai_insights;
DROP POLICY IF EXISTS "owner insights upsert" ON public.customer_ai_insights;
DROP POLICY IF EXISTS "owner insights update" ON public.customer_ai_insights;
DROP POLICY IF EXISTS "owner insights delete" ON public.customer_ai_insights;
CREATE POLICY "tenant insights all" ON public.customer_ai_insights
  FOR ALL TO authenticated
  USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));

-- line_inbound_messages
DROP POLICY IF EXISTS "owner inbound read" ON public.line_inbound_messages;
DROP POLICY IF EXISTS "owner inbound update" ON public.line_inbound_messages;
DROP POLICY IF EXISTS "owner inbound delete" ON public.line_inbound_messages;
CREATE POLICY "tenant inbound read" ON public.line_inbound_messages
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant inbound update" ON public.line_inbound_messages
  FOR UPDATE TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager inbound delete" ON public.line_inbound_messages
  FOR DELETE TO authenticated USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

-- line_pending_friends
DROP POLICY IF EXISTS "owner pending friends read" ON public.line_pending_friends;
DROP POLICY IF EXISTS "owner pending friends delete" ON public.line_pending_friends;
CREATE POLICY "tenant pending read" ON public.line_pending_friends
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant pending delete" ON public.line_pending_friends
  FOR DELETE TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));

-- booking_tokens read
DROP POLICY IF EXISTS "owner tokens read" ON public.booking_tokens;
CREATE POLICY "tenant tokens read" ON public.booking_tokens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = booking_tokens.customer_id
      AND public.is_tenant_member(c.owner_id, auth.uid())
  ));

-- campaign_sends read
DROP POLICY IF EXISTS "owner sends read" ON public.campaign_sends;
CREATE POLICY "tenant sends read" ON public.campaign_sends
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_sends.campaign_id
      AND public.is_tenant_member(c.owner_id, auth.uid())
  ));

-- scheduled_jobs
DROP POLICY IF EXISTS "owner jobs read" ON public.scheduled_jobs;
CREATE POLICY "tenant jobs read" ON public.scheduled_jobs
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));

-- external_reservation_logs
DROP POLICY IF EXISTS "owner ext logs read" ON public.external_reservation_logs;
CREATE POLICY "tenant ext logs read" ON public.external_reservation_logs
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));

-- line_message_log
DROP POLICY IF EXISTS "owner line log read" ON public.line_message_log;
CREATE POLICY "tenant line log read" ON public.line_message_log
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));

-- profiles
DROP POLICY IF EXISTS "own profile read" ON public.profiles;
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "tenant profile read" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(id, auth.uid()) OR public_slug IS NOT NULL);
CREATE POLICY "manager profile update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(id, auth.uid(), 'manager'::public.app_role));

-- ============================================================
-- 6. handle_new_user trigger update
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, salon_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'salon_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner'::public.app_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
  VALUES (NEW.id, NEW.id, 'owner'::public.app_role, now())
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  INSERT INTO public.subscriptions (owner_id, status, plan, trial_ends_at)
  VALUES (NEW.id, 'trialing', 'standard', now() + INTERVAL '60 days')
  ON CONFLICT (owner_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- updated_at triggers
DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS usage_counters_updated_at ON public.tenant_usage_counters;
CREATE TRIGGER usage_counters_updated_at BEFORE UPDATE ON public.tenant_usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

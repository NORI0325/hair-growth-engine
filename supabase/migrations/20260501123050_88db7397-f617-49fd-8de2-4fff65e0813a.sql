-- ============================================
-- Phase 1: マルチ店舗対応 DB基盤
-- ============================================
-- このマイグレーションは以下を実施します:
-- 1. tenants テーブル新設（組織）
-- 2. locations テーブル新設（店舗）
-- 3. location_members テーブル新設（店舗別スタッフ権限）
-- 4. 全業務テーブルに location_id を追加
-- 5. 既存データを新構造に移行
-- 6. RLSポリシーを location ベースに刷新
-- ============================================

-- ===== 1. tenants テーブル =====
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  location_quota INTEGER NOT NULL DEFAULT 1, -- Stripe同期用、現在許可されている店舗数
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ===== 2. locations テーブル =====
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_slug TEXT UNIQUE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  -- profilesから移行する設定
  open_time TIME DEFAULT '10:00',
  close_time TIME DEFAULT '19:00',
  google_review_url TEXT,
  line_add_friend_url TEXT,
  line_channel_access_token TEXT,
  line_channel_secret TEXT,
  owner_notification_email TEXT,
  reminder_enabled BOOLEAN NOT NULL DEFAULT true,
  reminder_hour INTEGER NOT NULL DEFAULT 19,
  inbound_key TEXT DEFAULT ('sb-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  test_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_tenant ON public.locations(tenant_id);
CREATE INDEX idx_locations_slug ON public.locations(public_slug);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- ===== 3. location_members テーブル =====
-- スタッフが特定の店舗のみ管理する場合に使用
-- オーナーは tenant_members 経由で全店アクセスできるため、ここには登録しない
CREATE TABLE public.location_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, user_id)
);

CREATE INDEX idx_location_members_user ON public.location_members(user_id);
CREATE INDEX idx_location_members_location ON public.location_members(location_id);

ALTER TABLE public.location_members ENABLE ROW LEVEL SECURITY;

-- ===== 4. ヘルパー関数 =====

-- ユーザーが特定店舗にアクセスできるか
-- (オーナー = tenant経由で全店, スタッフ = location_members経由)
CREATE OR REPLACE FUNCTION public.is_location_accessible(_location_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- オーナー/マネージャーがテナント経由でアクセス
    SELECT 1 FROM public.locations l
    JOIN public.tenant_members tm ON tm.tenant_id = l.tenant_id
    WHERE l.id = _location_id
      AND tm.user_id = _user_id
      AND tm.accepted_at IS NOT NULL
      AND tm.role IN ('owner'::public.app_role, 'manager'::public.app_role, 'super_admin'::public.app_role)
  ) OR EXISTS (
    -- スタッフが個別店舗にアクセス
    SELECT 1 FROM public.location_members
    WHERE location_id = _location_id AND user_id = _user_id
  );
$$;

-- 店舗での最低ロールを満たすか
CREATE OR REPLACE FUNCTION public.has_location_role(_location_id UUID, _user_id UUID, _min_role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- テナント経由
    SELECT 1 FROM public.locations l
    JOIN public.tenant_members tm ON tm.tenant_id = l.tenant_id
    WHERE l.id = _location_id
      AND tm.user_id = _user_id
      AND tm.accepted_at IS NOT NULL
      AND CASE _min_role
        WHEN 'staff'::public.app_role       THEN tm.role IN ('staff','manager','owner','super_admin')
        WHEN 'manager'::public.app_role     THEN tm.role IN ('manager','owner','super_admin')
        WHEN 'owner'::public.app_role       THEN tm.role IN ('owner','super_admin')
        WHEN 'super_admin'::public.app_role THEN tm.role = 'super_admin'
        ELSE false
      END
  ) OR EXISTS (
    -- location_members 経由
    SELECT 1 FROM public.location_members
    WHERE location_id = _location_id AND user_id = _user_id
      AND CASE _min_role
        WHEN 'staff'::public.app_role       THEN role IN ('staff','manager','owner','super_admin')
        WHEN 'manager'::public.app_role     THEN role IN ('manager','owner','super_admin')
        WHEN 'owner'::public.app_role       THEN role IN ('owner','super_admin')
        WHEN 'super_admin'::public.app_role THEN role = 'super_admin'
        ELSE false
      END
  );
$$;

-- 現在のユーザーが所属するテナントID
CREATE OR REPLACE FUNCTION public.user_tenant_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
   WHERE user_id = _user_id AND accepted_at IS NOT NULL
   ORDER BY (role = 'owner'::public.app_role) DESC, accepted_at ASC
   LIMIT 1;
$$;

-- ===== 5. 既存テーブルに location_id 追加 =====
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.incentives ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.salon_hours ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.staff_schedules ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.staff_time_off ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.line_templates ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.template_overrides ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.customer_message_templates ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.line_inbound_messages ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.line_pending_friends ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.external_reservation_logs ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.scheduled_jobs ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.customer_ai_insights ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.tenant_usage_counters ADD COLUMN IF NOT EXISTS location_id UUID;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- ===== 6. 既存データ移行 =====
-- 各 profile に対し tenant + location(primary) を生成
DO $$
DECLARE
  p RECORD;
  new_tenant_id UUID;
  new_location_id UUID;
BEGIN
  FOR p IN SELECT * FROM public.profiles LOOP
    -- tenant 作成 (id = profile.id を維持して既存tenant_membersと整合)
    INSERT INTO public.tenants (id, name, owner_user_id)
    VALUES (
      p.id,
      COALESCE(NULLIF(p.salon_name, ''), p.full_name, 'My Salon'),
      p.id
    )
    ON CONFLICT (id) DO NOTHING;
    
    new_tenant_id := p.id;
    
    -- 1店舗目作成
    INSERT INTO public.locations (
      tenant_id, name, public_slug, is_primary,
      open_time, close_time, google_review_url, line_add_friend_url,
      line_channel_access_token, line_channel_secret,
      owner_notification_email, reminder_enabled, reminder_hour,
      inbound_key, test_mode
    )
    VALUES (
      new_tenant_id,
      COALESCE(NULLIF(p.salon_name, ''), 'Main'),
      COALESCE(p.public_slug, 'salon-' || substr(replace(p.id::text, '-', ''), 1, 10)),
      true,
      p.open_time, p.close_time, p.google_review_url, p.line_add_friend_url,
      p.line_channel_access_token, p.line_channel_secret,
      p.owner_notification_email, COALESCE(p.reminder_enabled, true), COALESCE(p.reminder_hour, 19),
      p.inbound_key, COALESCE(p.test_mode, false)
    )
    RETURNING id INTO new_location_id;
    
    -- 業務データに location_id を埋める
    UPDATE public.customers SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.bookings SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.staff SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.menu_items SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.coupons SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.incentives SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.salon_hours SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.staff_schedules SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.staff_time_off SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.campaigns SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.line_templates SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.template_overrides SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.customer_message_templates SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.line_inbound_messages SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.line_pending_friends SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.external_reservation_logs SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.scheduled_jobs SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.customer_ai_insights SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.tenant_usage_counters SET location_id = new_location_id WHERE owner_id = p.id AND location_id IS NULL;
    UPDATE public.subscriptions SET tenant_id = new_tenant_id WHERE owner_id = p.id AND tenant_id IS NULL;
  END LOOP;
END $$;

-- ===== 7. tenants/locations RLS ポリシー =====

CREATE POLICY "tenant members read tenants"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (is_tenant_member(id, auth.uid()) OR has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "owner manage tenants"
  ON public.tenants FOR ALL
  TO authenticated
  USING (has_tenant_role(id, auth.uid(), 'owner'::public.app_role))
  WITH CHECK (has_tenant_role(id, auth.uid(), 'owner'::public.app_role));

CREATE POLICY "tenant members read locations"
  ON public.locations FOR SELECT
  TO authenticated
  USING (
    is_tenant_member(tenant_id, auth.uid())
    OR EXISTS (SELECT 1 FROM public.location_members WHERE location_id = locations.id AND user_id = auth.uid())
    OR public_slug IS NOT NULL
  );

CREATE POLICY "public locations read"
  ON public.locations FOR SELECT
  TO anon
  USING (public_slug IS NOT NULL);

CREATE POLICY "owner manage locations"
  ON public.locations FOR ALL
  TO authenticated
  USING (has_tenant_role(tenant_id, auth.uid(), 'owner'::public.app_role))
  WITH CHECK (has_tenant_role(tenant_id, auth.uid(), 'owner'::public.app_role));

CREATE POLICY "owner manage location members"
  ON public.location_members FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = location_members.location_id
        AND has_tenant_role(l.tenant_id, auth.uid(), 'owner'::public.app_role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.locations l
      WHERE l.id = location_members.location_id
        AND has_tenant_role(l.tenant_id, auth.uid(), 'owner'::public.app_role)
    )
  );

CREATE POLICY "members read own location memberships"
  ON public.location_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ===== 8. updated_at トリガー =====
CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

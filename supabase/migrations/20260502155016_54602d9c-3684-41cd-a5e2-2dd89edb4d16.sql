
-- ① 電子カルテ（基本情報）
CREATE TABLE public.customer_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  location_id uuid,
  hair_type text,
  hair_thickness text,
  hair_density text,
  damage_level smallint,
  scalp_condition text,
  allergies text,
  has_diamine_allergy boolean NOT NULL DEFAULT false,
  is_pregnant boolean NOT NULL DEFAULT false,
  pregnancy_due_date date,
  medical_notes text,
  preferred_style text,
  ng_keywords text,
  preferred_talk_level smallint,
  preferred_scent text,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant charts read" ON public.customer_charts
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant charts write" ON public.customer_charts
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant charts update" ON public.customer_charts
  FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager charts delete" ON public.customer_charts
  FOR DELETE TO authenticated USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE INDEX idx_customer_charts_customer ON public.customer_charts(customer_id);
CREATE INDEX idx_customer_charts_owner ON public.customer_charts(owner_id);

CREATE TRIGGER trg_customer_charts_updated_at
  BEFORE UPDATE ON public.customer_charts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ② 施術履歴
CREATE TABLE public.chart_treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  location_id uuid,
  booking_id uuid,
  staff_id uuid,
  treatment_date date NOT NULL DEFAULT CURRENT_DATE,
  menu_summary text,
  color_recipe jsonb DEFAULT '[]'::jsonb,
  perm_recipe jsonb DEFAULT '[]'::jsonb,
  products_used jsonb DEFAULT '[]'::jsonb,
  before_photo_url text,
  after_photo_url text,
  extra_photo_urls text[] DEFAULT ARRAY[]::text[],
  duration_minutes integer,
  customer_reaction text,
  next_suggestion text,
  staff_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chart_treatments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant treatments read" ON public.chart_treatments
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant treatments write" ON public.chart_treatments
  FOR INSERT TO authenticated WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant treatments update" ON public.chart_treatments
  FOR UPDATE TO authenticated USING (is_tenant_member(owner_id, auth.uid())) WITH CHECK (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager treatments delete" ON public.chart_treatments
  FOR DELETE TO authenticated USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE INDEX idx_chart_treatments_customer ON public.chart_treatments(customer_id, treatment_date DESC);
CREATE INDEX idx_chart_treatments_owner ON public.chart_treatments(owner_id);
CREATE INDEX idx_chart_treatments_staff ON public.chart_treatments(staff_id);
CREATE INDEX idx_chart_treatments_booking ON public.chart_treatments(booking_id);

CREATE TRIGGER trg_chart_treatments_updated_at
  BEFORE UPDATE ON public.chart_treatments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ③ Storage バケット（カルテ写真）
INSERT INTO storage.buckets (id, name, public)
VALUES ('chart-photos', 'chart-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "tenant chart photos read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chart-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT tm.tenant_id::text FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "tenant chart photos write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chart-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT tm.tenant_id::text FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "tenant chart photos delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chart-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT tm.tenant_id::text FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- ④ スタッフ歩合ルール
CREATE TABLE public.staff_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  location_id uuid,
  base_salary integer NOT NULL DEFAULT 0,
  nominated_tech_rate numeric(5,2) NOT NULL DEFAULT 50.0,
  free_tech_rate numeric(5,2) NOT NULL DEFAULT 30.0,
  retail_rate numeric(5,2) NOT NULL DEFAULT 10.0,
  monthly_target integer NOT NULL DEFAULT 0,
  target_bonus integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_commission_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager commission write" ON public.staff_commission_rules
  FOR ALL TO authenticated
  USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role))
  WITH CHECK (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE POLICY "tenant commission read" ON public.staff_commission_rules
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));

CREATE INDEX idx_staff_commission_staff ON public.staff_commission_rules(staff_id);
CREATE INDEX idx_staff_commission_owner ON public.staff_commission_rules(owner_id);

CREATE TRIGGER trg_staff_commission_updated_at
  BEFORE UPDATE ON public.staff_commission_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ⑤ ブリーフィング送信ログ
CREATE TABLE public.briefing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, channel)
);

ALTER TABLE public.briefing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant briefing read" ON public.briefing_logs
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));

CREATE INDEX idx_briefing_owner_date ON public.briefing_logs(owner_id, sent_at DESC);

-- ⑥ bookings に「指名予約」フラグ追加
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_nominated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.is_nominated IS '指名予約（true=指名歩合適用、false=フリー歩合）';

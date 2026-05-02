-- ============================================
-- Phase 8: Segmented Reactivation
-- ============================================

-- 1) Enum: customer retention segment
DO $$ BEGIN
  CREATE TYPE public.retention_segment AS ENUM (
    'cold_1',       -- 1回来店 / 90-180日経過（試しただけ）
    'warm_mid',     -- 2-3回来店 / 90-180日経過（決め手なし）
    'loyal_risk',   -- 4回以上 / 90-180日経過（不満の可能性）
    'lost_1',       -- 1回 / 180日以上（ほぼ戻らない）
    'churned',      -- 2-3回 / 180日以上（謝罪+ヒアリング）
    'vip_lost'      -- 高額/高頻度（4回以上 or 累計10万円以上）/ 180日以上 → 手動対応必須
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) classify_customer_segment 関数
CREATE OR REPLACE FUNCTION public.classify_customer_segment(_customer_id uuid)
RETURNS retention_segment
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  days_since integer;
BEGIN
  SELECT visit_count, total_spent, last_visit_date
    INTO c FROM customers WHERE id = _customer_id;
  IF NOT FOUND OR c.last_visit_date IS NULL THEN
    RETURN 'cold_1'::retention_segment;
  END IF;
  days_since := (CURRENT_DATE - c.last_visit_date);

  -- VIP 判定（高額 or 高頻度の元常連が180日以上離れている）
  IF days_since >= 180
     AND (COALESCE(c.total_spent,0) >= 100000 OR COALESCE(c.visit_count,0) >= 10) THEN
    RETURN 'vip_lost'::retention_segment;
  END IF;

  IF days_since >= 180 THEN
    IF COALESCE(c.visit_count,0) <= 1 THEN RETURN 'lost_1'::retention_segment;
    ELSIF COALESCE(c.visit_count,0) <= 3 THEN RETURN 'churned'::retention_segment;
    ELSE RETURN 'churned'::retention_segment;
    END IF;
  END IF;

  -- at-risk 帯（90-180日）
  IF COALESCE(c.visit_count,0) <= 1 THEN RETURN 'cold_1'::retention_segment;
  ELSIF COALESCE(c.visit_count,0) <= 3 THEN RETURN 'warm_mid'::retention_segment;
  ELSE RETURN 'loyal_risk'::retention_segment;
  END IF;
END $$;

-- 3) reactivation_segment_templates: セグメント別テンプレ上書き
CREATE TABLE IF NOT EXISTS public.reactivation_segment_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  segment retention_segment not null,
  enabled boolean not null default true,
  subject text,
  body text,
  cta_label text,
  discount_percent integer,
  tone text default 'polite',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  UNIQUE (owner_id, segment)
);
ALTER TABLE public.reactivation_segment_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rst all" ON public.reactivation_segment_templates;
CREATE POLICY "tenant rst all" ON public.reactivation_segment_templates
  FOR ALL TO authenticated
  USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role))
  WITH CHECK (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

DROP TRIGGER IF EXISTS rst_set_updated ON public.reactivation_segment_templates;
CREATE TRIGGER rst_set_updated BEFORE UPDATE ON public.reactivation_segment_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) create_reactivation_jobs を再定義 → セグメントを payload に保存・VIP は強制 pending_approval
CREATE OR REPLACE FUNCTION public.create_reactivation_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count INTEGER := 0;
BEGIN
  WITH stage_rows AS (
    SELECT
      p.id AS owner_id,
      (s.idx - 1)::int AS stage_index,
      (s.stage->>'days')::int AS days,
      COALESCE((s.stage->>'discount_percent')::int, 20) AS discount_percent,
      COALESCE(s.stage->>'label', '') AS label,
      p.approval_mode,
      p.approval_required_templates
    FROM public.profiles p,
    LATERAL jsonb_array_elements(COALESCE(p.reactivation_stages, '[]'::jsonb))
      WITH ORDINALITY AS s(stage, idx)
    WHERE COALESCE(p.reactivation_enabled, true) = true
      AND jsonb_typeof(p.reactivation_stages) = 'array'
  ),
  candidates AS (
    SELECT
      c.owner_id, c.id AS customer_id, c.last_visit_date,
      sr.stage_index, sr.days, sr.discount_percent, sr.label,
      sr.approval_mode, sr.approval_required_templates,
      public.classify_customer_segment(c.id) AS seg
    FROM public.customers c
    JOIN stage_rows sr ON sr.owner_id = c.owner_id
    WHERE c.last_visit_date BETWEEN
            CURRENT_DATE - (sr.days + 3) * INTERVAL '1 day'
        AND CURRENT_DATE - (sr.days - 3) * INTERVAL '1 day'
      AND COALESCE(c.is_test, false) = false
      AND (c.quiet_until IS NULL OR c.quiet_until <= now())
      AND NOT EXISTS (
        SELECT 1 FROM public.scheduled_jobs j
        WHERE j.customer_id = c.id
          AND j.job_type = 'reactivation'
          AND COALESCE((j.payload->>'stage_index')::int, (j.payload->>'stage')::int - 1) = sr.stage_index
          AND j.created_at > c.last_visit_date::timestamptz
      )
  ),
  inserted AS (
    INSERT INTO public.scheduled_jobs
      (owner_id, customer_id, job_type, scheduled_for, payload, approval_status)
    SELECT
      ca.owner_id, ca.customer_id, 'reactivation',
      ((CURRENT_DATE + TIME '10:00') AT TIME ZONE 'Asia/Tokyo'),
      jsonb_build_object(
        'stage', ca.stage_index + 1,
        'stage_index', ca.stage_index,
        'days_since', (CURRENT_DATE - ca.last_visit_date),
        'discount_percent', ca.discount_percent,
        'label', ca.label,
        'segment', ca.seg::text
      ),
      CASE
        WHEN ca.seg = 'vip_lost'::retention_segment THEN 'pending_approval'::job_approval_status
        WHEN ca.approval_mode = 'semi_auto' THEN 'pending_approval'::job_approval_status
        WHEN ca.approval_mode = 'per_template'
             AND 'reactivation' = ANY(ca.approval_required_templates)
          THEN 'pending_approval'::job_approval_status
        ELSE 'auto'::job_approval_status
      END
    FROM candidates ca
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO _count FROM inserted;
  RETURN _count;
END $$;

-- 5) seed default segment templates for existing owners (only if missing)
INSERT INTO public.reactivation_segment_templates (owner_id, segment, subject, body, cta_label, discount_percent, tone)
SELECT p.id, 'cold_1'::retention_segment,
  '改めまして、{salon_name}のご紹介です',
  E'{customer_name}様\n\n以前は{salon_name}にお越しいただき、誠にありがとうございました。\n\n少しお時間が空いてしまいましたが、改めまして当店の魅力をご案内させてください。\n\nご都合が合うときに、ぜひもう一度お試しいただけますと嬉しいです。',
  '空き状況を見る', 30, 'polite'
FROM public.profiles p
ON CONFLICT (owner_id, segment) DO NOTHING;

INSERT INTO public.reactivation_segment_templates (owner_id, segment, subject, body, cta_label, discount_percent, tone)
SELECT p.id, 'warm_mid'::retention_segment,
  'またお会いできるのを楽しみにしております',
  E'{customer_name}様\n\nいつもありがとうございます。\n少し間が空いてしまいましたね。お変わりなくお過ごしでしょうか。\n\n季節の変わり目、髪の状態も変化しやすい時期です。\nお気軽にご相談くださいませ。',
  'ご予約はこちら', 15, 'friendly'
FROM public.profiles p
ON CONFLICT (owner_id, segment) DO NOTHING;

INSERT INTO public.reactivation_segment_templates (owner_id, segment, subject, body, cta_label, discount_percent, tone)
SELECT p.id, 'loyal_risk'::retention_segment,
  '{customer_name}様、お変わりありませんか',
  E'{customer_name}様\n\nいつも{salon_name}をご愛顧いただき、本当にありがとうございます。\n\n少しお会いできていない期間が続いており、何か至らぬ点がございましたら申し訳ございません。\n\nもしお時間ございましたら、近況など聞かせていただけますと嬉しいです。',
  'メニュー相談を予約', 20, 'luxury'
FROM public.profiles p
ON CONFLICT (owner_id, segment) DO NOTHING;

INSERT INTO public.reactivation_segment_templates (owner_id, segment, subject, body, cta_label, discount_percent, tone)
SELECT p.id, 'lost_1'::retention_segment,
  '季節のご挨拶',
  E'{customer_name}様\n\n以前は{salon_name}にお立ち寄りいただき、ありがとうございました。\n\n季節のご挨拶を兼ねて、ご案内させていただきました。\nもしまた機会がございましたら、お気軽にお越しくださいませ。',
  '空き状況を見る', 30, 'polite'
FROM public.profiles p
ON CONFLICT (owner_id, segment) DO NOTHING;

INSERT INTO public.reactivation_segment_templates (owner_id, segment, subject, body, cta_label, discount_percent, tone)
SELECT p.id, 'churned'::retention_segment,
  'ご無沙汰しております',
  E'{customer_name}様\n\nご無沙汰しております。{salon_name}でございます。\n\n以前ご来店いただいた際、もし至らぬ点がございましたら、心よりお詫び申し上げます。\nご意見・ご感想をお聞かせいただけますと、今後の励みになります。\n\nお詫びを込めて、特別なご案内をさせていただきます。',
  'ご来店のご相談', 25, 'polite'
FROM public.profiles p
ON CONFLICT (owner_id, segment) DO NOTHING;

INSERT INTO public.reactivation_segment_templates (owner_id, segment, subject, body, cta_label, discount_percent, tone, enabled)
SELECT p.id, 'vip_lost'::retention_segment,
  '【オーナー手書き推奨】{customer_name}様へのご連絡',
  E'※このセグメントはVIP顧客の離脱です。自動配信せず、オーナー様ご自身からお手紙やLINEでの直接ご連絡を強くおすすめいたします。\n\n（参考雛形）\n{customer_name}様\n\nいつも{salon_name}にお越しいただき、本当にありがとうございました。\n少しお会いできない期間が続いており、何かお力になれることがあればと思いご連絡いたしました。',
  '個別連絡', 0, 'luxury', true
FROM public.profiles p
ON CONFLICT (owner_id, segment) DO NOTHING;
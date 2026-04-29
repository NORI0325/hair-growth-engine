
-- 特典マスターテーブル
CREATE TABLE public.incentives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gift',
  title TEXT NOT NULL,
  description TEXT,
  terms TEXT,
  estimated_cost INTEGER DEFAULT 0,
  value_label TEXT,
  target_segment TEXT DEFAULT 'all',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incentives_owner ON public.incentives(owner_id, active, sort_order);

ALTER TABLE public.incentives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner incentives all"
ON public.incentives FOR ALL
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_incentives_updated_at
BEFORE UPDATE ON public.incentives
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- template_overrides に incentive_id を追加
ALTER TABLE public.template_overrides
  ADD COLUMN IF NOT EXISTS incentive_id UUID;

-- 新規オーナー登録時にサンプル特典を投入
CREATE OR REPLACE FUNCTION public.create_default_incentives()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.incentives (owner_id, kind, title, description, terms, estimated_cost, value_label, target_segment, sort_order) VALUES
    (NEW.id, 'gift', '🎁 ヘアオイル ミニサイズ プレゼント', 'サロン専売のヘアオイル(10ml)を次回ご来店時にプレゼントいたします。', '次回ご来店時、お会計時にお渡しします。', 300, '¥1,500相当', 'dormant', 1),
    (NEW.id, 'service_addon', '✨ ヘッドスパ 10分 無料追加', '通常メニューに、リラックスヘッドスパを10分無料でお付けします。', 'カット・カラー・パーマと同時利用に限ります。', 500, '¥2,200相当', 'at_risk', 2),
    (NEW.id, 'upgrade', '💎 トリートメント ワンランクアップ', 'ご注文のトリートメントを上位グレードへ無料アップグレードいたします。', '次回ご来店時、トリートメントメニューと同時にご利用いただけます。', 800, '¥3,000相当', 'at_risk', 3),
    (NEW.id, 'priority', '👑 優先予約枠のご案内', '通常より一週間早く、人気の土日枠を優先的にご案内いたします。', 'お電話またはLINEにてご予約ください。', 0, 'プレミアム特典', 'vip', 4),
    (NEW.id, 'experience', '🌿 季節限定ヘッドスパ 体験', '今季新登場のアロマヘッドスパ(15分)を特別価格でご体験いただけます。', '通常¥3,000のところ、初回限定¥1,000でご提供。', 600, '初回特別価格', 'all', 5),
    (NEW.id, 'discount', '💝 ご愛顧感謝 10%OFF クーポン', '次回お会計より全メニュー10%OFF。', '他クーポンとの併用不可。次回ご来店時1回限り。', 0, '10%OFF', 'dormant', 6);
  RETURN NEW;
END;
$$;

-- profiles INSERT 時に発火
DROP TRIGGER IF EXISTS create_default_incentives_trigger ON public.profiles;
CREATE TRIGGER create_default_incentives_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.create_default_incentives();

-- 既存オーナーにもサンプル投入（特典0件のオーナーのみ）
INSERT INTO public.incentives (owner_id, kind, title, description, terms, estimated_cost, value_label, target_segment, sort_order)
SELECT p.id, v.kind, v.title, v.description, v.terms, v.estimated_cost, v.value_label, v.target_segment, v.sort_order
FROM public.profiles p
CROSS JOIN (VALUES
  ('gift', '🎁 ヘアオイル ミニサイズ プレゼント', 'サロン専売のヘアオイル(10ml)を次回ご来店時にプレゼントいたします。', '次回ご来店時、お会計時にお渡しします。', 300, '¥1,500相当', 'dormant', 1),
  ('service_addon', '✨ ヘッドスパ 10分 無料追加', '通常メニューに、リラックスヘッドスパを10分無料でお付けします。', 'カット・カラー・パーマと同時利用に限ります。', 500, '¥2,200相当', 'at_risk', 2),
  ('upgrade', '💎 トリートメント ワンランクアップ', 'ご注文のトリートメントを上位グレードへ無料アップグレードいたします。', '次回ご来店時、トリートメントメニューと同時にご利用いただけます。', 800, '¥3,000相当', 'at_risk', 3),
  ('priority', '👑 優先予約枠のご案内', '通常より一週間早く、人気の土日枠を優先的にご案内いたします。', 'お電話またはLINEにてご予約ください。', 0, 'プレミアム特典', 'vip', 4),
  ('experience', '🌿 季節限定ヘッドスパ 体験', '今季新登場のアロマヘッドスパ(15分)を特別価格でご体験いただけます。', '通常¥3,000のところ、初回限定¥1,000でご提供。', 600, '初回特別価格', 'all', 5),
  ('discount', '💝 ご愛顧感謝 10%OFF クーポン', '次回お会計より全メニュー10%OFF。', '他クーポンとの併用不可。次回ご来店時1回限り。', 0, '10%OFF', 'dormant', 6)
) AS v(kind, title, description, terms, estimated_cost, value_label, target_segment, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.incentives i WHERE i.owner_id = p.id);

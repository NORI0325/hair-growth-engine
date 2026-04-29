
-- 1) 新規ユーザー向け：プロファイル作成時にデフォルトクーポンを自動投入する関数
CREATE OR REPLACE FUNCTION public.create_default_coupons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.coupons (owner_id, title, description, discount_type, discount_value, expires_at) VALUES
    (NEW.id, '🎟️ 次回ご来店 10%OFF',          '次回ご来店時、全メニュー10%OFFいたします。',                'percent', 10,   (CURRENT_DATE + INTERVAL '90 days')::date),
    (NEW.id, '🎟️ 次回ご来店 20%OFF',          'ご愛顧感謝、次回全メニュー20%OFFいたします。',              'percent', 20,   (CURRENT_DATE + INTERVAL '60 days')::date),
    (NEW.id, '💴 全メニュー ¥1,000 OFF',      'お会計より¥1,000割引いたします。',                          'amount',  1000, (CURRENT_DATE + INTERVAL '90 days')::date),
    (NEW.id, '💴 全メニュー ¥2,000 OFF',      'お会計より¥2,000割引いたします。',                          'amount',  2000, (CURRENT_DATE + INTERVAL '60 days')::date),
    (NEW.id, '🎂 お誕生月特別 30%OFF',         'お誕生月のご来店で全メニュー30%OFF。日頃の感謝を込めて。',  'percent', 30,   NULL),
    (NEW.id, '💌 ご紹介ありがとう ¥1,500 OFF','ご紹介いただいたお客様へ、感謝を込めて¥1,500 OFF。',         'amount',  1500, NULL),
    (NEW.id, '✨ ご新規様 初回限定 20%OFF',    '初めてご来店のお客様限定、全メニュー20%OFFでお試しいただけます。','percent', 20, NULL),
    (NEW.id, '☕ 平日限定 15%OFF',             '月〜金のご来店で全メニュー15%OFF。',                        'percent', 15,   (CURRENT_DATE + INTERVAL '90 days')::date),
    (NEW.id, '🏆 5回目ご来店記念 ¥3,000 OFF', 'いつもありがとうございます。5回目のご来店を記念して特別割引。','amount',  3000, NULL),
    (NEW.id, '💇 カラー＋トリートメント セット ¥1,500 OFF', '同時ご利用でセット価格¥1,500 OFF。',           'amount',  1500, (CURRENT_DATE + INTERVAL '120 days')::date);
  RETURN NEW;
END;
$$;

-- 2) 新規プロファイル作成時に発火するトリガー
DROP TRIGGER IF EXISTS trg_create_default_coupons ON public.profiles;
CREATE TRIGGER trg_create_default_coupons
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.create_default_coupons();

-- 3) 既存ユーザー向け：クーポンが1件も無いオーナーへ同じ10種を投入
INSERT INTO public.coupons (owner_id, title, description, discount_type, discount_value, expires_at)
SELECT p.id, v.title, v.description, v.discount_type, v.discount_value, v.expires_at
FROM public.profiles p
CROSS JOIN (VALUES
  ('🎟️ 次回ご来店 10%OFF',          '次回ご来店時、全メニュー10%OFFいたします。',                'percent', 10,   (CURRENT_DATE + INTERVAL '90 days')::date),
  ('🎟️ 次回ご来店 20%OFF',          'ご愛顧感謝、次回全メニュー20%OFFいたします。',              'percent', 20,   (CURRENT_DATE + INTERVAL '60 days')::date),
  ('💴 全メニュー ¥1,000 OFF',      'お会計より¥1,000割引いたします。',                          'amount',  1000, (CURRENT_DATE + INTERVAL '90 days')::date),
  ('💴 全メニュー ¥2,000 OFF',      'お会計より¥2,000割引いたします。',                          'amount',  2000, (CURRENT_DATE + INTERVAL '60 days')::date),
  ('🎂 お誕生月特別 30%OFF',         'お誕生月のご来店で全メニュー30%OFF。日頃の感謝を込めて。',  'percent', 30,   NULL::date),
  ('💌 ご紹介ありがとう ¥1,500 OFF','ご紹介いただいたお客様へ、感謝を込めて¥1,500 OFF。',         'amount',  1500, NULL::date),
  ('✨ ご新規様 初回限定 20%OFF',    '初めてご来店のお客様限定、全メニュー20%OFFでお試しいただけます。','percent', 20, NULL::date),
  ('☕ 平日限定 15%OFF',             '月〜金のご来店で全メニュー15%OFF。',                        'percent', 15,   (CURRENT_DATE + INTERVAL '90 days')::date),
  ('🏆 5回目ご来店記念 ¥3,000 OFF', 'いつもありがとうございます。5回目のご来店を記念して特別割引。','amount',  3000, NULL::date),
  ('💇 カラー＋トリートメント セット ¥1,500 OFF', '同時ご利用でセット価格¥1,500 OFF。',           'amount',  1500, (CURRENT_DATE + INTERVAL '120 days')::date)
) AS v(title, description, discount_type, discount_value, expires_at)
WHERE NOT EXISTS (SELECT 1 FROM public.coupons c WHERE c.owner_id = p.id);

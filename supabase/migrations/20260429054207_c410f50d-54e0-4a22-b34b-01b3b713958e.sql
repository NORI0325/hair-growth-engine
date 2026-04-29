CREATE TABLE public.customer_message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom', -- 'early' | 'delay' | 'reschedule' | 'custom'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner customer_message_templates all" ON public.customer_message_templates
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX idx_customer_message_templates_owner ON public.customer_message_templates(owner_id, sort_order);

CREATE TRIGGER customer_message_templates_updated_at
  BEFORE UPDATE ON public.customer_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 既存オーナー全員にデフォルト3テンプレートを投入
INSERT INTO public.customer_message_templates (owner_id, kind, title, body, sort_order)
SELECT p.id, t.kind, t.title, t.body, t.sort_order
FROM public.profiles p
CROSS JOIN (VALUES
  ('early', '🌸 少しお早くご案内できます',
   E'{customer_name}様\n\nいつもありがとうございます。\n本日の準備が予定より早めに整いそうです。\n\nもしご都合よろしければ、{new_time}頃のご来店も可能です。\nもちろん当初のお時間でも問題ございません。\n\nご無理のないようお越しくださいませ。',
   1),
  ('delay', '☕ 少しごゆっくりお越しくださいませ',
   E'{customer_name}様\n\nいつもありがとうございます。\n本日のご予約のお時間ですが、少しお待たせしてしまう可能性がございます。\n\n{minutes}分ほどゆっくりとお越しいただけますと幸いです。\nお手数をおかけしますが、何卒よろしくお願いいたします。',
   2),
  ('reschedule', '💭 お時間変更のご相談',
   E'{customer_name}様\n\nいつもありがとうございます。\n本日のご予約のお時間について、ご相談させていただきたくご連絡いたしました。\n\n誠に勝手ながら、{new_time}頃へのご変更は可能でしょうか。\nもしご都合が合わない場合はそのままのお時間で承りますので、ご無理なくお返事くださいませ。',
   3)
) AS t(kind, title, body, sort_order)
ON CONFLICT DO NOTHING;

-- 新規オーナー作成時にもデフォルトを自動投入
CREATE OR REPLACE FUNCTION public.create_default_message_templates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customer_message_templates (owner_id, kind, title, body, sort_order) VALUES
    (NEW.id, 'early', '🌸 少しお早くご案内できます',
     E'{customer_name}様\n\nいつもありがとうございます。\n本日の準備が予定より早めに整いそうです。\n\nもしご都合よろしければ、{new_time}頃のご来店も可能です。\nもちろん当初のお時間でも問題ございません。\n\nご無理のないようお越しくださいませ。', 1),
    (NEW.id, 'delay', '☕ 少しごゆっくりお越しくださいませ',
     E'{customer_name}様\n\nいつもありがとうございます。\n本日のご予約のお時間ですが、少しお待たせしてしまう可能性がございます。\n\n{minutes}分ほどゆっくりとお越しいただけますと幸いです。\nお手数をおかけしますが、何卒よろしくお願いいたします。', 2),
    (NEW.id, 'reschedule', '💭 お時間変更のご相談',
     E'{customer_name}様\n\nいつもありがとうございます。\n本日のご予約のお時間について、ご相談させていただきたくご連絡いたしました。\n\n誠に勝手ながら、{new_time}頃へのご変更は可能でしょうか。\nもしご都合が合わない場合はそのままのお時間で承りますので、ご無理なくお返事くださいませ。', 3);
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_default_message_templates
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_default_message_templates();
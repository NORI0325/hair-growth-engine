
-- ============== profiles に設定追加 ==============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS points_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS points_earn_rate_percent INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS points_signup_bonus INTEGER NOT NULL DEFAULT 1000;

-- ============== point_transactions (元帳) ==============
CREATE TABLE IF NOT EXISTS public.point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  customer_id UUID NOT NULL,
  points INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('earn_booking','bonus_signup','bonus_manual','redeem','redeem_cancel','expire','adjust')),
  reference_booking_id UUID,
  reference_redemption_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_point_tx_customer ON public.point_transactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_tx_owner ON public.point_transactions(owner_id, created_at DESC);

ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant point_tx read" ON public.point_transactions
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "manager point_tx insert" ON public.point_transactions
  FOR INSERT TO authenticated WITH CHECK (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

-- ============== point_redemption_items (交換カタログ) ==============
CREATE TABLE IF NOT EXISTS public.point_redemption_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  kind TEXT NOT NULL DEFAULT 'service_addon',
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stock INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_point_items_owner ON public.point_redemption_items(owner_id, sort_order);
ALTER TABLE public.point_redemption_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant point_items read" ON public.point_redemption_items
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "public point_items read" ON public.point_redemption_items
  FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY "manager point_items all" ON public.point_redemption_items
  FOR ALL TO authenticated
  USING (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role))
  WITH CHECK (has_tenant_role(owner_id, auth.uid(), 'manager'::app_role));

CREATE TRIGGER trg_point_items_updated_at
  BEFORE UPDATE ON public.point_redemption_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============== point_redemptions (交換履歴) ==============
CREATE TABLE IF NOT EXISTS public.point_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  item_id UUID NOT NULL,
  item_name_snapshot TEXT NOT NULL,
  points_used INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled')),
  booking_id UUID,
  applied_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_redemptions_customer ON public.point_redemptions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemptions_owner ON public.point_redemptions(owner_id, status, created_at DESC);
ALTER TABLE public.point_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant redemptions read" ON public.point_redemptions
  FOR SELECT TO authenticated USING (is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant redemptions update" ON public.point_redemptions
  FOR UPDATE TO authenticated
  USING (is_tenant_member(owner_id, auth.uid()))
  WITH CHECK (is_tenant_member(owner_id, auth.uid()));

-- ============== 残高ビュー ==============
CREATE OR REPLACE VIEW public.customer_point_balances AS
SELECT
  customer_id,
  owner_id,
  COALESCE(SUM(points), 0)::INTEGER AS balance,
  MAX(created_at) AS last_activity_at
FROM public.point_transactions
GROUP BY customer_id, owner_id;

-- ============== 残高取得関数（顧客向けトークン経由） ==============
CREATE OR REPLACE FUNCTION public.get_customer_point_summary(_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _customer_id UUID;
  _balance INTEGER;
  _txs jsonb;
  _items jsonb;
BEGIN
  SELECT customer_id INTO _customer_id FROM public.booking_tokens WHERE token = _token;
  IF _customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  SELECT COALESCE(SUM(points),0) INTO _balance
    FROM public.point_transactions WHERE customer_id = _customer_id;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO _txs
  FROM (
    SELECT points, kind, note, created_at
    FROM public.point_transactions
    WHERE customer_id = _customer_id
    ORDER BY created_at DESC LIMIT 30
  ) t;

  SELECT COALESCE(jsonb_agg(i ORDER BY i.sort_order), '[]'::jsonb) INTO _items
  FROM (
    SELECT i.id, i.name, i.description, i.points_cost, i.image_url, i.sort_order
    FROM public.point_redemption_items i
    JOIN public.customers c ON c.id = _customer_id
    WHERE i.owner_id = c.owner_id AND i.active = true
      AND (i.stock IS NULL OR i.stock > 0)
    ORDER BY i.sort_order
  ) i;

  RETURN jsonb_build_object(
    'success', true,
    'balance', _balance,
    'transactions', _txs,
    'redemption_items', _items
  );
END $$;

-- ============== 交換申請関数（顧客から） ==============
CREATE OR REPLACE FUNCTION public.redeem_customer_points(_token TEXT, _item_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _customer_id UUID;
  _owner_id UUID;
  _balance INTEGER;
  _item RECORD;
  _redemption_id UUID;
BEGIN
  SELECT customer_id INTO _customer_id FROM public.booking_tokens WHERE token = _token;
  IF _customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  SELECT owner_id INTO _owner_id FROM public.customers WHERE id = _customer_id;

  SELECT * INTO _item FROM public.point_redemption_items
   WHERE id = _item_id AND owner_id = _owner_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'item_not_found');
  END IF;
  IF _item.stock IS NOT NULL AND _item.stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'out_of_stock');
  END IF;

  SELECT COALESCE(SUM(points),0) INTO _balance
    FROM public.point_transactions WHERE customer_id = _customer_id;

  IF _balance < _item.points_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_points', 'balance', _balance, 'cost', _item.points_cost);
  END IF;

  INSERT INTO public.point_redemptions
    (owner_id, customer_id, item_id, item_name_snapshot, points_used, status)
  VALUES
    (_owner_id, _customer_id, _item.id, _item.name, _item.points_cost, 'pending')
  RETURNING id INTO _redemption_id;

  INSERT INTO public.point_transactions
    (owner_id, customer_id, points, kind, reference_redemption_id, note)
  VALUES
    (_owner_id, _customer_id, -_item.points_cost, 'redeem', _redemption_id,
     '交換申請: ' || _item.name);

  IF _item.stock IS NOT NULL THEN
    UPDATE public.point_redemption_items SET stock = stock - 1 WHERE id = _item.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'redemption_id', _redemption_id, 'remaining_balance', _balance - _item.points_cost);
END $$;

-- ============== 予約完了時の自動ポイント付与 ==============
CREATE OR REPLACE FUNCTION public.award_points_on_booking_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _enabled BOOLEAN;
  _rate INTEGER;
  _earned INTEGER;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_test, false) THEN RETURN NEW; END IF;
  -- 自社チャネルのみ（外部予約サイト経由は付与しない＝切替インセンティブ）
  IF NEW.external_reservation_id IS NOT NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.revenue, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(points_enabled, true), COALESCE(points_earn_rate_percent, 5)
    INTO _enabled, _rate
    FROM public.profiles WHERE id = NEW.owner_id;

  IF NOT _enabled OR _rate <= 0 THEN RETURN NEW; END IF;

  _earned := FLOOR(NEW.revenue::NUMERIC * _rate / 100)::INTEGER;
  IF _earned <= 0 THEN RETURN NEW; END IF;

  -- 同一予約での重複防止
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
    WHERE reference_booking_id = NEW.id AND kind = 'earn_booking'
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.point_transactions
    (owner_id, location_id, customer_id, points, kind, reference_booking_id, note)
  VALUES
    (NEW.owner_id, NEW.location_id, NEW.customer_id, _earned, 'earn_booking', NEW.id,
     'ご来店ポイント (' || _rate || '%)');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_points_on_complete ON public.bookings;
CREATE TRIGGER trg_award_points_on_complete
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.award_points_on_booking_complete();

-- ============== LINE登録ボーナス自動付与 ==============
CREATE OR REPLACE FUNCTION public.award_line_signup_bonus()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _enabled BOOLEAN;
  _bonus INTEGER;
BEGIN
  IF NEW.line_user_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.line_user_id IS NOT NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_test, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(points_enabled, true), COALESCE(points_signup_bonus, 1000)
    INTO _enabled, _bonus
    FROM public.profiles WHERE id = NEW.owner_id;

  IF NOT _enabled OR _bonus <= 0 THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.point_transactions
    WHERE customer_id = NEW.id AND kind = 'bonus_signup'
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.point_transactions
    (owner_id, location_id, customer_id, points, kind, note)
  VALUES
    (NEW.owner_id, NEW.location_id, NEW.id, _bonus, 'bonus_signup',
     'LINE連携ありがとうボーナス');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_line_signup_bonus ON public.customers;
CREATE TRIGGER trg_award_line_signup_bonus
  AFTER UPDATE OF line_user_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.award_line_signup_bonus();

-- ============== 既存LINE連携済みの顧客に遡及付与（一回限り） ==============
INSERT INTO public.point_transactions (owner_id, location_id, customer_id, points, kind, note)
SELECT c.owner_id, c.location_id, c.id,
       COALESCE(p.points_signup_bonus, 1000),
       'bonus_signup',
       'LINE連携ありがとうボーナス（遡及付与）'
FROM public.customers c
JOIN public.profiles p ON p.id = c.owner_id
WHERE c.line_user_id IS NOT NULL
  AND COALESCE(c.is_test, false) = false
  AND COALESCE(p.points_enabled, true) = true
  AND COALESCE(p.points_signup_bonus, 1000) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.point_transactions pt
    WHERE pt.customer_id = c.id AND pt.kind = 'bonus_signup'
  );

-- ============== 既存の完了済み予約に遡及付与（自社チャネルのみ） ==============
INSERT INTO public.point_transactions (owner_id, location_id, customer_id, points, kind, reference_booking_id, note)
SELECT b.owner_id, b.location_id, b.customer_id,
       FLOOR(b.revenue::NUMERIC * COALESCE(p.points_earn_rate_percent, 5) / 100)::INTEGER,
       'earn_booking', b.id,
       'ご来店ポイント（遡及付与）'
FROM public.bookings b
JOIN public.profiles p ON p.id = b.owner_id
WHERE b.status = 'completed'
  AND COALESCE(b.is_test, false) = false
  AND b.external_reservation_id IS NULL
  AND COALESCE(b.revenue, 0) > 0
  AND COALESCE(p.points_enabled, true) = true
  AND FLOOR(b.revenue::NUMERIC * COALESCE(p.points_earn_rate_percent, 5) / 100)::INTEGER > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.point_transactions pt
    WHERE pt.reference_booking_id = b.id AND pt.kind = 'earn_booking'
  );

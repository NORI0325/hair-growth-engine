-- 1) handle_new_user を招待検出対応に
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _salon_name TEXT;
  _location_id UUID;
  _is_invited BOOLEAN := false;
BEGIN
  -- 招待メールに該当する未受諾の招待があるか
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_invitations
    WHERE lower(email) = lower(NEW.email)
      AND accepted_at IS NULL
      AND expires_at > now()
  ) INTO _is_invited;

  _salon_name := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'salon_name', ''), 'My Salon');

  -- profile は常に作成（個人情報として必要）
  INSERT INTO public.profiles (id, full_name, salon_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    CASE WHEN _is_invited THEN NULL ELSE _salon_name END
  )
  ON CONFLICT (id) DO NOTHING;

  -- 招待ユーザーの場合：自分用テナント/店舗/owner ロールは作らない（招待受諾時に staff/manager として参加）
  IF _is_invited THEN
    RETURN NEW;
  END IF;

  -- 通常サインアップ：オーナーロール
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner'::public.app_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
  VALUES (NEW.id, NEW.id, 'owner'::public.app_role, now())
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  INSERT INTO public.tenants (id, name, owner_user_id)
  VALUES (NEW.id, _salon_name, NEW.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.locations (tenant_id, name, public_slug, is_primary)
  VALUES (
    NEW.id,
    _salon_name,
    'salon-' || substr(replace(NEW.id::text, '-', ''), 1, 10),
    true
  )
  RETURNING id INTO _location_id;

  INSERT INTO public.subscriptions (owner_id, tenant_id, status, plan, trial_ends_at)
  VALUES (NEW.id, NEW.id, 'trialing', 'standard', now() + INTERVAL '60 days')
  ON CONFLICT (owner_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2) 既に誤生成された cb2f4a59 (okada@i-technologyjapan.com) の "My Salon" 一式を削除
-- 招待先 bacec668 への manager メンバーシップは保持
DELETE FROM public.subscriptions WHERE owner_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb' AND tenant_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb';
DELETE FROM public.locations WHERE tenant_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb';
DELETE FROM public.tenant_members WHERE tenant_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb' AND user_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb';
DELETE FROM public.tenants WHERE id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb';
DELETE FROM public.user_roles WHERE user_id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb' AND role = 'owner'::public.app_role;
UPDATE public.profiles SET salon_name = NULL WHERE id = 'cb2f4a59-2281-4af0-9a96-13757bb33ceb' AND salon_name = 'My Salon';
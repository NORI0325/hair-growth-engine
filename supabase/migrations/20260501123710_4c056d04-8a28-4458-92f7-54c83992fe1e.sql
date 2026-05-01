-- handle_new_user を更新して tenants + locations も作成
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _salon_name TEXT;
  _location_id UUID;
BEGIN
  _salon_name := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'salon_name', ''), 'My Salon');

  -- 既存の profile (legacy)
  INSERT INTO public.profiles (id, full_name, salon_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    _salon_name
  )
  ON CONFLICT (id) DO NOTHING;

  -- ロール
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner'::public.app_role)
  ON CONFLICT DO NOTHING;

  -- tenant_members
  INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
  VALUES (NEW.id, NEW.id, 'owner'::public.app_role, now())
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  -- ⭐ tenants
  INSERT INTO public.tenants (id, name, owner_user_id)
  VALUES (NEW.id, _salon_name, NEW.id)
  ON CONFLICT (id) DO NOTHING;

  -- ⭐ 1店舗目作成
  INSERT INTO public.locations (tenant_id, name, public_slug, is_primary)
  VALUES (
    NEW.id,
    _salon_name,
    'salon-' || substr(replace(NEW.id::text, '-', ''), 1, 10),
    true
  )
  RETURNING id INTO _location_id;

  -- subscription
  INSERT INTO public.subscriptions (owner_id, tenant_id, status, plan, trial_ends_at)
  VALUES (NEW.id, NEW.id, 'trialing', 'standard', now() + INTERVAL '60 days')
  ON CONFLICT (owner_id) DO NOTHING;

  RETURN NEW;
END;
$$;
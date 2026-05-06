
-- 1. channel_integrations 列追加
ALTER TABLE public.channel_integrations
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS default_rsv_route_id TEXT NOT NULL DEFAULT 'K000000001',
  ADD COLUMN IF NOT EXISTS storage_state_path TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_create_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_update_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_cancel_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS allow_unmapped_booking BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_enabled_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.channel_integrations
    ADD CONSTRAINT ci_connection_status_check
    CHECK (connection_status IN ('disconnected','connected','mapping_incomplete','test_pending','live','paused','reauth_required'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. salonboard_sessions（owner+location単位）
CREATE TABLE IF NOT EXISTS public.salonboard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  location_id UUID,
  login_id_encrypted TEXT,
  password_encrypted TEXT,
  storage_state_encrypted TEXT,
  last_login_at TIMESTAMPTZ,
  login_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salonboard_sessions
  ON public.salonboard_sessions (owner_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.salonboard_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant sb sessions read" ON public.salonboard_sessions;
DROP POLICY IF EXISTS "tenant sb sessions write" ON public.salonboard_sessions;
DROP POLICY IF EXISTS "tenant sb sessions update" ON public.salonboard_sessions;
DROP POLICY IF EXISTS "tenant sb sessions delete" ON public.salonboard_sessions;

CREATE POLICY "tenant sb sessions read" ON public.salonboard_sessions
  FOR SELECT TO authenticated USING (public.is_tenant_member(owner_id, auth.uid()));
CREATE POLICY "tenant sb sessions write" ON public.salonboard_sessions
  FOR INSERT TO authenticated WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));
CREATE POLICY "tenant sb sessions update" ON public.salonboard_sessions
  FOR UPDATE TO authenticated USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role))
  WITH CHECK (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));
CREATE POLICY "tenant sb sessions delete" ON public.salonboard_sessions
  FOR DELETE TO authenticated USING (public.has_tenant_role(owner_id, auth.uid(), 'manager'::public.app_role));

DROP TRIGGER IF EXISTS trg_sb_sessions_updated_at ON public.salonboard_sessions;
CREATE TRIGGER trg_sb_sessions_updated_at BEFORE UPDATE ON public.salonboard_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. staff/menu mappings
ALTER TABLE public.staff_channel_mappings
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.menu_channel_mappings
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS external_setmenu_id TEXT,
  ADD COLUMN IF NOT EXISTS rsv_term INTEGER;

-- 既存external_idをexternal_setmenu_idに同期（NULL時のみ）
UPDATE public.menu_channel_mappings
   SET external_setmenu_id = external_id
 WHERE external_setmenu_id IS NULL AND external_id IS NOT NULL AND channel = 'salonboard';

-- 4. bookings 拡張
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS sync_attempt_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'pending_sync';
EXCEPTION WHEN others THEN NULL; END $$;

-- 5. RPC: is_salonboard_live
CREATE OR REPLACE FUNCTION public.is_salonboard_live(_owner_id uuid, _location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channel_integrations ci
    WHERE ci.owner_id = _owner_id
      AND ci.channel = 'salonboard'
      AND COALESCE(ci.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ci.enabled = true
      AND ci.sync_enabled = true
      AND ci.connection_status = 'live'
      AND ci.test_create_passed_at IS NOT NULL
      AND ci.test_update_passed_at IS NOT NULL
      AND ci.test_cancel_passed_at IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM public.salonboard_sessions s
    WHERE s.owner_id = _owner_id
      AND COALESCE(s.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND s.login_status IN ('ok','active','success')
  )
  AND EXISTS (
    SELECT 1 FROM public.staff_channel_mappings
    WHERE owner_id = _owner_id AND channel = 'salonboard' AND enabled = true
  )
  AND EXISTS (
    SELECT 1 FROM public.menu_channel_mappings
    WHERE owner_id = _owner_id AND channel = 'salonboard' AND enabled = true
  );
$$;

-- 6. RPC: recompute_channel_status
CREATE OR REPLACE FUNCTION public.recompute_channel_status(_owner_id uuid, _location_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _has_session BOOLEAN;
  _has_staff BOOLEAN;
  _has_menu BOOLEAN;
  _ci RECORD;
  _next TEXT;
BEGIN
  SELECT * INTO _ci FROM public.channel_integrations
   WHERE owner_id = _owner_id AND channel = 'salonboard'
     AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF NOT FOUND THEN RETURN 'disconnected'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.salonboard_sessions s
    WHERE s.owner_id = _owner_id
      AND COALESCE(s.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND s.login_status IN ('ok','active','success'))
    INTO _has_session;

  SELECT EXISTS (SELECT 1 FROM public.staff_channel_mappings
    WHERE owner_id = _owner_id AND channel='salonboard' AND enabled=true) INTO _has_staff;
  SELECT EXISTS (SELECT 1 FROM public.menu_channel_mappings
    WHERE owner_id = _owner_id AND channel='salonboard' AND enabled=true) INTO _has_menu;

  IF NOT _has_session THEN
    _next := CASE WHEN _ci.connection_status='live' THEN 'reauth_required' ELSE 'disconnected' END;
  ELSIF NOT (_has_staff AND _has_menu) THEN
    _next := 'mapping_incomplete';
  ELSIF _ci.test_create_passed_at IS NULL OR _ci.test_update_passed_at IS NULL OR _ci.test_cancel_passed_at IS NULL THEN
    _next := 'test_pending';
  ELSIF _ci.live_enabled_at IS NOT NULL AND _ci.sync_enabled THEN
    _next := 'live';
  ELSE
    _next := 'connected';
  END IF;

  UPDATE public.channel_integrations SET connection_status = _next
   WHERE id = _ci.id;
  RETURN _next;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_scm_owner_channel_enabled
  ON public.staff_channel_mappings (owner_id, channel) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_mcm_owner_channel_enabled
  ON public.menu_channel_mappings (owner_id, channel) WHERE enabled = true;

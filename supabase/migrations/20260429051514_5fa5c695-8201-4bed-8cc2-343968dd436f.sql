-- ============ menu_items ============
CREATE TABLE public.menu_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_items_owner ON public.menu_items(owner_id, sort_order);

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner menu_items all"
ON public.menu_items FOR ALL TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "public menu_items read"
ON public.menu_items FOR SELECT TO anon, authenticated
USING (active = true);

CREATE TRIGGER trg_menu_items_updated
BEFORE UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ bookings: 複数メニュー対応 ============
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS menus TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS total_price INTEGER;

-- ============ line_pending_friends ============
CREATE TABLE public.line_pending_friends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  last_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, line_user_id)
);

CREATE INDEX idx_pending_friends_owner ON public.line_pending_friends(owner_id, created_at DESC);

ALTER TABLE public.line_pending_friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner pending friends read"
ON public.line_pending_friends FOR SELECT TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY "owner pending friends delete"
ON public.line_pending_friends FOR DELETE TO authenticated
USING (auth.uid() = owner_id);

CREATE TRIGGER trg_pending_friends_updated
BEFORE UPDATE ON public.line_pending_friends
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
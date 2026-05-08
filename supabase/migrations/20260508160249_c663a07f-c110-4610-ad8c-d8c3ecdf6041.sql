
-- 予約同期の状態確認スナップショット
CREATE TABLE public.sync_diff_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  location_id UUID NULL,
  booking_id UUID NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'salonboard',
  result TEXT NOT NULL CHECK (result IN ('local_only','external_only','match','conflict','error')),
  reason TEXT NULL,
  local_payload JSONB NULL,
  external_payload JSONB NULL,
  diff JSONB NULL,
  external_reservation_id TEXT NULL,
  checked_by UUID NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_diff_owner ON public.sync_diff_snapshots(owner_id, checked_at DESC);
CREATE INDEX idx_sync_diff_booking ON public.sync_diff_snapshots(booking_id, checked_at DESC);

ALTER TABLE public.sync_diff_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can view sync snapshots"
ON public.sync_diff_snapshots FOR SELECT
USING (owner_id = auth.uid() OR (location_id IS NOT NULL AND public.is_location_accessible(location_id, auth.uid())));

CREATE POLICY "owner can insert sync snapshots"
ON public.sync_diff_snapshots FOR INSERT
WITH CHECK (owner_id = auth.uid() OR (location_id IS NOT NULL AND public.has_location_role(location_id, auth.uid(), 'manager'::app_role)));

-- service_role からの insert は RLS bypass されるので OK

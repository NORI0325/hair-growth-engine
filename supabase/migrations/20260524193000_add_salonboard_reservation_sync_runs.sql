-- Run-level audit log and lock for Salonboard reservation range dry runs.
-- Phase 1-2 only: stores fetch/diff summaries. It does not import bookings.

CREATE TABLE IF NOT EXISTS public.salonboard_reservation_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  location_id uuid,
  run_type text NOT NULL DEFAULT 'manual'
    CHECK (run_type IN ('manual', 'scheduled')),
  slot text NOT NULL DEFAULT 'manual'
    CHECK (slot IN ('morning', 'noon', 'evening', 'manual')),
  mode text NOT NULL DEFAULT 'dry_run'
    CHECK (mode IN ('dry_run', 'import')),
  range_start date NOT NULL,
  range_end date NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  fetched_days integer NOT NULL DEFAULT 0,
  fetched_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  matched_with_diff_count integer NOT NULL DEFAULT 0,
  salonboard_only_count integer NOT NULL DEFAULT 0,
  local_only_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  needs_review_count integer NOT NULL DEFAULT 0,
  error_type text,
  error_message text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salonboard_reservation_sync_runs_range_check CHECK (range_end >= range_start)
);

CREATE INDEX IF NOT EXISTS idx_sb_res_sync_runs_owner_created
  ON public.salonboard_reservation_sync_runs(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sb_res_sync_runs_owner_location_status
  ON public.salonboard_reservation_sync_runs(owner_id, location_id, status, started_at DESC);

-- Lock policy: only one running reservation range sync per owner/location.
-- The Edge Function marks stale running rows failed before creating a new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sb_res_sync_runs_running_lock
  ON public.salonboard_reservation_sync_runs(
    owner_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'running';

DROP TRIGGER IF EXISTS trg_sb_res_sync_runs_updated_at ON public.salonboard_reservation_sync_runs;
CREATE TRIGGER trg_sb_res_sync_runs_updated_at
  BEFORE UPDATE ON public.salonboard_reservation_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.salonboard_reservation_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read salonboard reservation sync runs"
  ON public.salonboard_reservation_sync_runs;
CREATE POLICY "tenant read salonboard reservation sync runs"
  ON public.salonboard_reservation_sync_runs
  FOR SELECT
  TO authenticated
  USING (
    public.is_tenant_member(owner_id, auth.uid())
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

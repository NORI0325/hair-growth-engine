
ALTER TABLE public.line_message_log
  ADD COLUMN IF NOT EXISTS location_id uuid;

CREATE INDEX IF NOT EXISTS idx_line_message_log_location
  ON public.line_message_log(location_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS line_rich_menu_id text;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS line_rich_menu_id text;

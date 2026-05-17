ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS line_booking_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_booking_paused_message text;
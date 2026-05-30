ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS line_official_account_id text;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS line_official_account_id text;

COMMENT ON COLUMN public.profiles.line_official_account_id
  IS 'LINE Official Account ID used to open oaMessage links for customer-specific QR codes.';

COMMENT ON COLUMN public.locations.line_official_account_id
  IS 'Per-location LINE Official Account ID used to open oaMessage links for customer-specific QR codes.';

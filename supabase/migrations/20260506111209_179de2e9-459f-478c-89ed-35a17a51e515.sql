
ALTER TABLE public.channel_menu_options
  ADD COLUMN IF NOT EXISTS net_coupon_id text,
  ADD COLUMN IF NOT EXISTS source_type text;

ALTER TABLE public.menu_channel_mappings
  ADD COLUMN IF NOT EXISTS net_coupon_id text;

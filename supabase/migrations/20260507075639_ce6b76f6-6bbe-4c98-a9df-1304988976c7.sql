CREATE UNIQUE INDEX IF NOT EXISTS channel_integrations_owner_location_channel_arbiter_unique
ON public.channel_integrations (owner_id, location_id, channel);
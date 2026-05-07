CREATE UNIQUE INDEX IF NOT EXISTS channel_integrations_owner_location_channel_unique
ON public.channel_integrations (owner_id, location_id, channel)
WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS channel_integrations_owner_channel_nulloc_unique
ON public.channel_integrations (owner_id, channel)
WHERE location_id IS NULL;
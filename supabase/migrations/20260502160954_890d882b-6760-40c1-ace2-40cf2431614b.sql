ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS pin_code text;
ALTER TABLE public.staff ADD CONSTRAINT staff_pin_format CHECK (pin_code IS NULL OR pin_code ~ '^[0-9]{4,6}$');
CREATE INDEX IF NOT EXISTS idx_staff_owner_pin ON public.staff(owner_id, pin_code) WHERE pin_code IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_gender') THEN
    CREATE TYPE public.customer_gender AS ENUM ('female','male','other','unknown');
  END IF;
END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS gender public.customer_gender NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_customers_gender ON public.customers(owner_id, gender);

DROP VIEW IF EXISTS public.customer_point_balances;
CREATE VIEW public.customer_point_balances
WITH (security_invoker = true) AS
SELECT
  customer_id,
  owner_id,
  COALESCE(SUM(points), 0)::INTEGER AS balance,
  MAX(created_at) AS last_activity_at
FROM public.point_transactions
GROUP BY customer_id, owner_id;

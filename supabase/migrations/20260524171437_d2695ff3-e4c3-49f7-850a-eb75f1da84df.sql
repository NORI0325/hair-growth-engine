create or replace function public.get_salonboard_cron_secret()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'salonboard_reservation_sync_cron_secret'
  limit 1
$$;

revoke all on function public.get_salonboard_cron_secret() from public, anon, authenticated;
grant execute on function public.get_salonboard_cron_secret() to service_role;
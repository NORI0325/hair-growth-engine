# SalonBoost Safety Modernization Runbook

This document is the deployment and verification guide for the full safety
modernization prepared on 2026-07-28. The code commit does not apply a database
migration, deploy an Edge Function, restart the Worker, or send data to an
external service.

## Goals

- Keep SalonBoard authoritative for live SalonBoard locations.
- Make menu display, booking writes, and sync payloads use the same active
  `SN...` setmenu and `rsv_term` rules.
- Preserve incomplete external reservations as `needs_review` instead of
  silently inventing a duration or sending them back to SalonBoard.
- Prevent cross-location and cross-tenant reads and writes.
- Support customer directories larger than the PostgREST 1,000-row response
  limit.
- Require authenticated or internal authorization for privileged Edge
  Functions.
- Make Worker configuration, logs, and concurrent browser operations safer.

## Non-Goals

This rollout must not:

- backfill or delete production rows automatically
- deploy all changes in one unobserved step
- enable SalonBoard automatic imports
- create a `sync_job` for an external mirror reservation
- resend, update, or cancel an external mirror reservation from SalonBoost
- change production secrets while traffic is active

## Migration Order

Apply these migrations in this order, one at a time:

1. `20260728100000_harden_internal_functions_and_customer_identity.sql`
2. `20260728110000_add_paginated_customer_directory.sql`
3. `20260728120000_guard_booking_location_and_overlap.sql`
4. `20260728130000_align_public_bookable_menus_with_salonboard.sql`

Do not apply step 3 or 4 until the preflight queries below have been reviewed.
Each migration changes future behavior; none intentionally rewrites historical
customer or booking data.

## Preflight SQL

All statements in this section are read-only.

### Customer identity

Duplicate LINE identities must be reviewed before enabling the LINE uniqueness
trigger:

```sql
select owner_id, line_user_id, count(*) as duplicate_count,
       array_agg(id order by created_at) as customer_ids
from public.customers
where line_user_id is not null and btrim(line_user_id) <> ''
group by owner_id, line_user_id
having count(*) > 1
order by duplicate_count desc;
```

Shared phone numbers are allowed, but these rows should be reviewed before a
large import so operators can distinguish family sharing from duplicate data:

```sql
select owner_id,
       regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as normalized_phone,
       count(*) as customer_count,
       array_agg(id order by created_at) as customer_ids
from public.customers
where phone is not null and phone <> ''
group by owner_id, regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
having count(*) > 1
order by customer_count desc;
```

Customers without a location will not appear in a location-scoped directory:

```sql
select owner_id, count(*) as missing_location_count
from public.customers
where location_id is null
group by owner_id
order by missing_location_count desc;
```

### Booking integrity

```sql
select id, owner_id, customer_id, booking_date, booking_time,
       source_channel, external_source, status, sync_status, created_at
from public.bookings
where location_id is null
order by created_at desc;
```

```sql
select id, owner_id, location_id, booking_date, booking_time,
       total_duration_minutes, source_channel, external_source,
       needs_manual_review, sync_status
from public.bookings
where total_duration_minutes is null or total_duration_minutes <= 0
order by booking_date desc, booking_time desc;
```

Potential staff overlaps, using unknown duration as a full-day conflict:

```sql
with active as (
  select b.*,
         b.booking_date::timestamp + b.booking_time as starts_at,
         b.booking_date::timestamp + b.booking_time
           + make_interval(mins => coalesce(nullif(b.total_duration_minutes, 0), 1440)) as ends_at
  from public.bookings b
  where b.staff_id is not null
    and b.status not in ('cancelled', 'completed', 'no_show')
)
select a.id as booking_id, b.id as overlaps_booking_id,
       a.owner_id, a.location_id, a.staff_id,
       a.starts_at, a.ends_at, b.starts_at as other_starts_at, b.ends_at as other_ends_at
from active a
join active b
  on b.id > a.id
 and b.owner_id = a.owner_id
 and b.location_id = a.location_id
 and b.staff_id = a.staff_id
 and b.starts_at < a.ends_at
 and b.ends_at > a.starts_at
order by a.starts_at desc;
```

### SalonBoard menu authority

```sql
select mi.id, mi.name, mi.location_id,
       mi.price as cached_price,
       mi.duration_minutes as cached_duration,
       mcm.enabled as mapping_enabled,
       coalesce(nullif(mcm.external_setmenu_id, ''), mcm.external_id) as setmenu_id,
       mcm.rsv_term as mapping_duration,
       cmo.active as salonboard_active,
       cmo.price as salonboard_price,
       cmo.rsv_term as salonboard_duration,
       case
         when cmo.id is null then 'channel_option_missing'
         when cmo.active is distinct from true then 'salonboard_inactive'
         when mcm.enabled is distinct from true then 'mapping_disabled'
         when coalesce(nullif(mcm.external_setmenu_id, ''), mcm.external_id) !~ '^SN[0-9]+$' then 'invalid_setmenu_id'
         when mcm.rsv_term is distinct from cmo.rsv_term then 'duration_mismatch'
         when mi.price is distinct from cmo.price then 'cached_price_mismatch'
         when mi.duration_minutes is distinct from cmo.rsv_term then 'cached_duration_mismatch'
         else 'ok'
       end as integrity_state
from public.menu_items mi
left join public.menu_channel_mappings mcm
  on mcm.menu_id = mi.id and mcm.owner_id = mi.owner_id
 and mcm.location_id = mi.location_id and mcm.channel = 'salonboard'
left join public.channel_menu_options cmo
  on cmo.owner_id = mi.owner_id and cmo.location_id = mi.location_id
 and cmo.channel = 'salonboard' and cmo.source_type = 'setmenu'
 and cmo.setmenu_id = coalesce(nullif(mcm.external_setmenu_id, ''), mcm.external_id)
order by mi.location_id, mi.name;
```

## Edge Function Deployment

Deploy the changed functions only after all four migrations are accepted. The
shared authentication and internal invocation modules are consumed at bundle
time, so every changed consumer must be deployed from the same commit.

High-risk booking and sync group:

- `create-booking`
- `staff-create-booking`
- `salonboard-import-reservation`
- `sync-import-from-salonboard`
- `sync-job-dispatch`
- `sync-job-retry`
- `sync-resend-to-salonboard`
- `sync-update-to-salonboard`
- `sync-cancel-to-salonboard`
- `sync-resolve-conflict`
- `sync-status-check`
- `sync-worker-callback`

Internal, cron, and notification group:

- `create-reactivation-jobs`
- `cron-check-unsynced-bookings`
- `cron-trial-expiry`
- `cron-trial-reminder`
- `notify-owner-booking`
- `notify-sync-failure`
- `process-thank-you-jobs`
- `send-briefing`
- `send-transactional-email`
- `send-team-invitation`

Customer, messaging, and integration group:

- `ai-classify-inbound`
- `ai-customer-insights`
- `ai-help-assistant`
- `ai-reply-suggestions`
- `auth-email-hook`
- `broadcast-preview`
- `bulk-broadcast`
- `ingest-salonboard-customers`
- `line-broadcast`
- `line-setup-rich-menu`
- `line-test-push`
- `line-webhook`
- `salonboard-bulk-import-menus`
- `salonboard-bulk-import-staff`
- `salonboard-fetch-day-reservations`
- `salonboard-fetch-menus`
- `salonboard-fetch-staff`
- `send-campaign`
- `send-customer-message`
- `sms-test-send`
- `submit-support-ticket`

Billing and utility group:

- `add-location`
- `remove-location`
- `create-checkout-session`
- `create-portal-session`
- `download-extension`

Before deployment, compare this list with:

```powershell
git diff --name-only origin/main...HEAD -- 'supabase/functions/*/index.ts'
```

## Required Configuration

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` where already required
- `PUBLIC_APP_ORIGIN=https://saronboost.com`
- `STRIPE_ENV=test` for the first billing smoke test
- `EDGE_INTERNAL_SECRET` is recommended for internal calls; service-role
  authentication remains supported

Do not place browser-exposed `VITE_*` values in Cloud Secrets. Never print a
secret value in an operations log or screenshot.

## Worker Rollout

1. Stop scheduling new sync work.
2. Pull the exact reviewed commit on the Worker VM.
3. Run `npm ci` in `salonboost-worker`.
4. Run `npm test` and `npm run build`.
5. Confirm `WORKER_API_KEY` is at least 24 characters.
6. Confirm `CALLBACK_URL` is the HTTPS `sync-worker-callback` URL.
7. Keep `ALLOW_ENV_CREDENTIAL_FALLBACK` unset or `false` unless an explicitly
   approved emergency fallback is being used.
8. Restart the Worker with the existing process manager.
9. Confirm `/healthz` returns HTTP 200.
10. Run one read-only single-day SalonBoard fetch and inspect redacted logs.

The Worker now serializes browser operations per owner/location. Independent
locations can still run concurrently.

## Smoke Test Matrix

Run in a non-production or test location first.

| Area | Expected result |
| --- | --- |
| Customer directory | Search, filter, and load more work beyond 1,000 rows |
| Customer add | New row appears immediately and after reload |
| Shared family phone | Registration is allowed; LINE identity remains unique per owner |
| Public booking, SalonBoard live | Only one active mapped `SN...` setmenu can be booked |
| Token booking | Correct `location_id` is saved and only that location creates sync jobs |
| Staff booking | Invalid/unmapped/multiple menus are rejected before insert |
| SalonBoard-off booking | Existing active menu behavior remains available |
| External mirror | Missing duration remains `needs_review`; no invented 60-minute duration |
| External mutation | Update, cancel, resend, and destructive UI actions remain blocked |
| Calendar | Null duration and `needs_review` are visibly flagged |
| LINE link | Public route never redirects to app login; duplicate LINE identity is rejected |
| Campaign/broadcast | Tenant scope and recipient caps are enforced |
| Internal email | Anonymous invocation is rejected; service-role invocation succeeds |
| Billing | Add/remove location uses server `STRIPE_ENV` and is tested in Stripe test mode first |

For booking tests, compare `bookings` and `sync_jobs` before and after each
request. Never use an external mirror booking for a write smoke test.

## Rollout Stages

1. Apply and verify customer/RPC migrations.
2. Apply booking and public-menu migrations during a quiet period.
3. Deploy booking/sync Edge Functions and test one test location.
4. Deploy internal/notification functions and verify authorization failures.
5. Deploy the remaining tenant-scope and UI changes.
6. Update the Worker VM and run read-only SalonBoard checks.
7. Observe one business day before enabling any additional cron schedule.

## Stop Procedure

Stop rollout immediately if any of these occur:

- a normal booking is rejected as an external mirror
- the public menu list differs from the booking guard result
- a booking is created without `location_id`
- a sync job is created for a location without a live integration
- an external mirror creates a sync job or reaches the Worker
- customer pages return another tenant's data
- Worker reports `captcha_required`, repeated `login_failed`, or parser drift

Actions:

1. Disable the affected scheduler and stop manual sync dispatch.
2. Do not delete bookings or sync jobs while diagnosing.
3. Preserve Edge and Worker logs with sensitive values redacted.
4. Roll back the affected Edge Function to the previous reviewed commit.
5. If a trigger is blocking valid writes, pause booking traffic and prepare a
   reviewed follow-up migration; do not edit an applied migration file.
6. Re-run the read-only integrity SQL before resuming.

## Known Residual Work

- Historical duplicate LINE identities and missing `location_id` rows require
  operator review; this change does not rewrite them.
- Full repository lint still contains substantial pre-existing
  `no-explicit-any` and related debt. TypeScript, production build, contract
  tests, Worker tests, and changed Edge bundles are the release gates for this
  branch.
- Development tooling currently reports transitive audit findings in ESLint's
  glob/minimatch chain. Production dependencies have no high or critical
  finding; the remaining React Router advisory is moderate and the app does not
  navigate using untrusted route strings.
- Automatic SalonBoard reservation import remains disabled until dry-run
  evidence and review rules are approved.

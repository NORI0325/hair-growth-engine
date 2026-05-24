# Salonboard Reservation Dry Run Cron Runbook

This runbook is for enabling Salonboard reservation mirror dry runs safely.

The goal is to run read-only reservation checks three times per day, save run logs, and review differences before any automatic import is enabled.

This is the canonical pre-enable operations document for the Salonboard reservation dry_run cron.

## Scope

This flow must not:

- insert or update `bookings`
- create `sync_jobs`
- send reservations to Salonboard
- change Salonboard data

The scheduler only invokes `salonboard-fetch-reservations-range` with `mode = 'dry_run'`.

## Components

- `salonboard-fetch-reservations-range`
  - Performs date range fetch and diff classification.
  - Writes `salonboard_reservation_sync_runs`.
  - Supports `mode = 'dry_run'` only for the current phase.

- `salonboard-reservation-sync-scheduler`
  - Finds location-level `salonboard` live integrations.
  - Invokes `salonboard-fetch-reservations-range` for each target.
  - Writes owner-level scheduler summaries to `sync_logs`.

- `SyncReview`
  - Shows latest manual and scheduled dry run status.
  - Shows 09:00 / 13:00 / 18:00 scheduled slots.

## Required Secrets

Required for `salonboard-fetch-reservations-range`:

- `EXTERNAL_WORKER_API_URL`
- `EXTERNAL_WORKER_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`

Required for `salonboard-reservation-sync-scheduler`:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `SALONBOARD_RESERVATION_SYNC_CRON_SECRET`

`CRON_SECRET` is accepted as a fallback, but `SALONBOARD_RESERVATION_SYNC_CRON_SECRET` is preferred because it is scoped to this job.

## Deploy Order

1. Confirm migration is applied:
   - `20260524193000_add_salonboard_reservation_sync_runs.sql`

2. Deploy Edge Functions:
   - `salonboard-fetch-reservations-range`
   - `salonboard-reservation-sync-scheduler`

3. Confirm Cloud Secrets are set.

4. Do one manual dry run from `SyncReview` for a single location.

5. Confirm run logs in `SyncReview` and SQL before enabling cron.

## Schedule

Use Asia/Tokyo business meaning.

| JST time | slot | range |
| --- | --- | --- |
| 09:00 | `morning` | today to tomorrow |
| 13:00 | `noon` | today to tomorrow |
| 18:00 | `evening` | today to today + 14 days |

UTC equivalents:

| JST time | UTC time |
| --- | --- |
| 09:00 | 00:00 |
| 13:00 | 04:00 |
| 18:00 | 09:00 |

Recommended cron body examples:

```json
{ "slot": "morning" }
```

```json
{ "slot": "noon" }
```

```json
{ "slot": "evening" }
```

Recommended headers:

```http
Content-Type: application/json
x-cron-secret: <SALONBOARD_RESERVATION_SYNC_CRON_SECRET>
```

The scheduler also accepts service-role bearer auth, but a scoped cron secret is preferred for cron callers.

## Initial Rollout

1. Deploy functions only. Do not enable cron yet.

2. Run manual dry run for one location from `SyncReview`.

3. Check:
   - no `bookings` were imported by the dry run
   - no `sync_jobs` were created by the dry run
   - `salonboard_reservation_sync_runs.status = 'success'`
   - `needs_review_count` is understandable
   - `sync_logs` contains a scheduler summary if scheduler was invoked

4. Enable only 09:00 for two business days.

5. If stable, enable 13:00.

6. If stable, enable 18:00.

7. Keep import mode disabled until dry runs are stable and review rules are agreed.

## Cron Pre-Enable Checklist

Complete this checklist before enabling any cron schedule.

- [ ] This runbook has been reviewed by the operator.
- [ ] `20260524193000_add_salonboard_reservation_sync_runs.sql` is applied.
- [ ] `salonboard-fetch-reservations-range` is deployed.
- [ ] `salonboard-reservation-sync-scheduler` is deployed.
- [ ] `EXTERNAL_WORKER_API_URL` is set.
- [ ] `EXTERNAL_WORKER_API_KEY` is set.
- [ ] `SALONBOARD_RESERVATION_SYNC_CRON_SECRET` is set.
- [ ] Worker VM has the latest Worker code and is listening.
- [ ] One manual scheduler dry_run has succeeded for the target location.
- [ ] `sync_logs` contains a scheduler summary for the manual scheduler dry_run.
- [ ] `salonboard_reservation_sync_runs` contains a successful dry_run row.
- [ ] `bookings_created_last_5min = 0`.
- [ ] `jobs_created_last_5min = 0`.
- [ ] No `captcha_required`, `login_failed`, or `timeout` occurred in the dry_run.
- [ ] Initial rollout choice is documented:
  - [ ] Enable only the 09:00 schedule first.
  - [ ] Enable all three schedules only after explicit approval.

Do not enable cron if any checklist item is unclear.

## Read-Only Verification SQL

Recent runs:

```sql
select
  id,
  owner_id,
  location_id,
  run_type,
  slot,
  mode,
  range_start,
  range_end,
  status,
  fetched_days,
  fetched_count,
  matched_count,
  matched_with_diff_count,
  salonboard_only_count,
  local_only_count,
  conflict_count,
  needs_review_count,
  error_type,
  error_message,
  created_at,
  finished_at
from public.salonboard_reservation_sync_runs
order by created_at desc
limit 50;
```

Scheduled slot health:

```sql
select distinct on (owner_id, location_id, slot)
  owner_id,
  location_id,
  slot,
  status,
  range_start,
  range_end,
  fetched_count,
  needs_review_count,
  error_type,
  error_message,
  created_at
from public.salonboard_reservation_sync_runs
where run_type = 'scheduled'
order by owner_id, location_id, slot, created_at desc;
```

Stale running locks:

```sql
select
  id,
  owner_id,
  location_id,
  slot,
  range_start,
  range_end,
  started_at,
  now() - started_at as running_for
from public.salonboard_reservation_sync_runs
where status = 'running'
order by started_at asc;
```

Scheduler summaries:

```sql
select
  owner_id,
  level,
  message,
  metadata,
  created_at
from public.sync_logs
where channel = 'salonboard'
  and message like '[scheduler] salonboard reservation dry_run%'
order by created_at desc
limit 50;
```

Critical failures:

```sql
select
  owner_id,
  location_id,
  slot,
  status,
  error_type,
  error_message,
  created_at
from public.salonboard_reservation_sync_runs
where status = 'failed'
   or error_type in (
     'captcha_required',
     'login_failed',
     'external_site_changed',
     'timeout',
     'session_expired',
     'session_expired_in_list'
   )
order by created_at desc
limit 50;
```

Zero-write verification:

```sql
select count(*) as bookings_created_last_5min
from public.bookings
where created_at >= now() - interval '5 minutes';
```

```sql
select count(*) as jobs_created_last_5min
from public.sync_jobs
where created_at >= now() - interval '5 minutes';
```

## Stop Procedure

If anything looks unsafe:

1. Pause the cron schedule first.
2. Do not manually invoke `salonboard-reservation-sync-scheduler`.
3. Do not run import mode.
4. If the cron secret may be exposed or misused, rotate `SALONBOARD_RESERVATION_SYNC_CRON_SECRET` before re-enabling cron.
5. Check `SyncReview`.
6. Check `salonboard_reservation_sync_runs`.
7. Check stale `running` rows using the stale running lock SQL above.
8. Check `worker_request_logs` for the same dates.
9. Check `bookings_created_last_5min` and `jobs_created_last_5min`.
10. If `captcha_required`, `login_failed`, or repeated `timeout` appears, keep cron disabled until the cause is understood.
11. Resume only after failed runs are understood and the Go criteria below are met again.

No data rollback should be needed because this phase is dry-run only.

## Go / No-Go Criteria

Go:

- Worker VM has the latest Worker code and is listening.
- A manual scheduler dry_run succeeded for the target location.
- `sync_logs` contains a scheduler summary.
- `bookings_created_last_5min = 0`.
- `jobs_created_last_5min = 0`.
- No `captcha_required`, `login_failed`, or `timeout`.
- This runbook has been reviewed and is reachable from `README.md`.
- 09:00 and 13:00 dry runs complete without critical failures.
- 18:00 dry run completes within acceptable time.
- `needs_review_count` is explainable.
- No unexplained stale `running` rows remain.
- Staff can interpret `SyncReview` output.

No-Go:

- Worker VM is not updated.
- Manual scheduler dry_run failed.
- `bookings` or `sync_jobs` increased during dry_run verification.
- `captcha_required`
- `login_failed`
- `external_site_changed`
- repeated `timeout`
- stale `running` rows
- large unexplained `salonboard_only_count`
- unclear duration or time extraction issues
- this runbook is missing or incomplete
- Stop Procedure is unclear
- `SALONBOARD_RESERVATION_SYNC_CRON_SECRET` is missing

## Next Phase

Only after dry-run stability:

1. Define strict automatic mirror import criteria.
2. Import only reservations with reliable `external_reservation_id`.
3. Keep bookings without duration or ambiguous identity as `needs_review`.
4. Continue to avoid creating `sync_jobs` for Salonboard-origin external reservations.

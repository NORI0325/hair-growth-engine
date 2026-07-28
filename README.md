# SalonBoost

SalonBoost is a multi-location salon CRM, booking, messaging, and SalonBoard
integration application. Production changes must preserve tenant/location
scope and treat SalonBoard as authoritative for live SalonBoard locations.

## Operations

- [Full safety modernization runbook](docs/full-safety-modernization-runbook.md)
- [Salonboard reservation dry-run cron runbook](docs/salonboard-reservation-dry-run-cron-runbook.md)

The runbooks are required reading before applying migrations, deploying Edge
Functions, updating the Worker VM, or enabling scheduled sync work.

# MED-01 — Structured Import Preview Retention

## Scope

MasterDataImportPreview contains temporary structured XLSX
preview payloads. Raw workbook bytes are not persisted.

The API blocks commit after the existing 10-minute TTL.
Expiry enforcement alone is not physical retention cleanup.

## Maintenance command

After the API build, run:

    pnpm --filter @novo/api purge:import-previews

The command executes compiled JavaScript:

    node dist/maintenance/purge-expired-import-previews.js

It deletes rows with expiresAt <= the execution cutoff,
globally across tenants and users.

Both consumed and unconsumed expired rows are eligible.
Unexpired rows are preserved.

The operation is idempotent and returns a deleted row count.
It logs no payload, fingerprint, identity, or tenant details.

## Required production scheduling

The production deployment owner MUST install a dedicated
scheduler to run the command every five minutes.

Example cron expression:

    */5 * * * *

The job must use the production application's built artifact
and an authorized DATABASE_URL supplied through the deployment
secret manager.

Do not embed credentials in repository files or cron arguments.

Do not use the GitHub Actions test database as a substitute for
the production maintenance scheduler.

The job must be monitored for nonzero exits, failures, and
missed executions. Investigate if no successful run occurs
within 15 minutes.

With a healthy five-minute scheduler, expired rows are
normally deleted within five minutes after the preview TTL,
plus execution delay. This is not a hard deletion guarantee
when the scheduler or database is unavailable.

## Acceptance

- Expired rows are removed across tenant and user boundaries.
- Expired consumed previews are removed.
- Rows expiring exactly at the cutoff are removed.
- Unexpired previews remain usable and stored.
- Repeated execution is safe and deletes zero additional rows.
- Job output contains only operational metadata.
- PostgreSQL integration tests pass.
- Production scheduler installation and execution are verified.

Do not mark MED-01 production CLOSED until the deployment owner
provides scheduler configuration and execution evidence.

Continue using synthetic data until the production data
protection and deployment prerequisites are approved.
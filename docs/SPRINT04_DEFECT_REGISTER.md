# Sprint 04 Defect Register

| ID | Severity | Status | Evidence / next control |
| --- | --- | --- | --- |
| HIGH-01 | High | CLOSED (owner-reported CI 40491042299) | Role-aware Product HPP serializer and write authorization were independently reviewed before this checkpoint. |
| HIGH-02A | High | CLOSED (CI 40810784095) | Migration atomicity, rollback, recovery, preflight failures, and concurrent writer backend PID verification passed PostgreSQL CI on commit 854b531. Production migration-history and legacy-data preflight remain deployment gates. |
| HIGH-02B | High | CLOSED (CI 40797043782) | Strict raw SKU API validation and HTTP regression tests passed PostgreSQL CI. |
| MED-01 | Medium | STAGING OPS PASS; PROD OPS OPEN | Global expired-preview purge and cross-tenant PostgreSQL regression tests passed CI 40804418422. Supabase staging Cron runs every 5 minutes; E2E verified DELETE 2 expired previews while preserving 1 valid preview, followed by synthetic-data cleanup. Render-to-Supabase Prisma integration also passed. See [Checkpoint 4 staging evidence](SPRINT04_CHECKPOINT04_STAGING_EVIDENCE.md). Production scheduling, monitoring, and execution evidence remain required before production closure. |

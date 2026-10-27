# Sprint 04 Defect Register

| ID | Severity | Status | Evidence / next control |
| --- | --- | --- | --- |
| HIGH-01 | High | CLOSED (owner-reported CI 40491042299) | Role-aware Product HPP serializer and write authorization were independently reviewed before this checkpoint. |
| HIGH-02 | High | code/migration pending CI | Case-sensitive PostgreSQL Product SKU uniqueness permitted legacy case variants. CP4-D2 adds read-only preflight, a forward canonical-storage CHECK migration, and direct database-write regressions. Run preflight/manual reconciliation and GitHub Actions PostgreSQL migration/tests before closure. |
| MED-01 | Medium | OPEN | Scheduled retention purge for structured import previews is mandatory before production personal-data processing. |
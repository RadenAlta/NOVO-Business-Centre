# Sprint 04 Defect Register

| ID | Severity | Status | Evidence / next control |
| --- | --- | --- | --- |
| HIGH-01 | High | CLOSED (owner-reported CI 40491042299) | Role-aware Product HPP serializer and write authorization were independently reviewed before this checkpoint. |
| HIGH-02A | High | code/test pending CI | SKU migration atomicity: CP4-D2-R1 changes the unmerged forward migration to take a bounded Product write lock and adds isolated pre-migration fixtures for clean, invalid, collision, cross-tenant, recovery, and concurrent-write cases. Verify no persistent environment has recorded the old checksum; run the staged GitHub Actions migration harness before closure. |
| HIGH-02B | High | OPEN | API input currently trims outer whitespace while the migration/preflight reject stored outer whitespace. CP4-D2-R1 intentionally does not modify whitespace API behavior; resolve and test the single acceptance policy in CP4-D2-R2. |
| MED-01 | Medium | OPEN | Scheduled retention purge for structured import previews is mandatory before production personal-data processing. |

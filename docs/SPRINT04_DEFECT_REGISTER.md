# Sprint 04 Defect Register

| ID | Severity | Status | Evidence / next control |
| --- | --- | --- | --- |
| HIGH-01 | High | CLOSED (owner-reported CI 40491042299) | Role-aware Product HPP serializer and write authorization were independently reviewed before this checkpoint. |
| HIGH-02A | High | CI PASS; audit sign-off pending | Migration, rollback, concurrent-write harness and preflight hardening passed GitHub Actions run 40802803159. Final audit sign-off remains required. |
| HIGH-02B | High | CLOSED (CI 40797043782) | Strict raw SKU API validation and HTTP regression tests passed PostgreSQL CI. |
| MED-01 | Medium | CODE PENDING CI; OPS OPEN | Global expired-preview purge command and PostgreSQL integration test are being implemented. Production scheduler installation and execution evidence remain mandatory. |

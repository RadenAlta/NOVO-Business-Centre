# Sprint 03 defect register — PR #3 code-review corrections

| ID | Severity | Disposition | Required evidence before approval |
| --- | --- | --- | --- |
| HIGH-03 | High | code fixed; CI pending | PostgreSQL integration proves 150 students do not hide active teacher/employee candidates; Web builds. |
| HIGH-04 | High | code fixed; CI pending | Unit and CI tests reject external hyperlink relationship and formula outside import region. |
| HIGH-05 | High | code fixed; CI pending | PostgreSQL trigger-failure test proves create/deactivate and audit rollback as one transaction. |
| MED-01 | Medium | OPEN | Mandatory scheduled retention purge before production personal data. |
| MED-02 | Medium | code fixed; CI pending | Template has no importable demo rows and template preview is rejected as empty. |
| MED-03 | Medium | code fixed; CI pending | SIMS activation state is rejected from manual API. |
| FR-003-D | Low | documented | Soft deactivation is the approved delete operation for Sprint 03; hard delete would break business history. |

Approval is blocked until the current branch commit and PR #3 CI complete successfully. No requirement status changes to `verified` from this register.

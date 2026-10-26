# Sprint 03 threat model — Master Data, Excel, and membership

## Code-review correction boundary

The authenticated server determines tenant, actor, role, eligibility and SIMS ownership. Browser input cannot set those values. Sprint 03 test data is synthetic only.

| Threat | Control after correction | Evidence |
| --- | --- | --- |
| Student-heavy directory hides eligible staff | Server endpoint scopes the tenant and filters `active=true` plus `type in TEACHER, EMPLOYEE` before search/pagination. | 150-student PostgreSQL integration regression. |
| External relationship or hyperlink in XLSX | ZIP relationship entries are decompressed and reject `TargetMode=External`; cell policy rejects external hyperlinks. | Unit workbook with generated hyperlink relationship. |
| Formula outside data cells | Any formula anywhere in `Master Data` or `Instructions` rejects the workbook before preview. | Unit Instructions-sheet formula case. |
| Formula-like import data | Field-level formula-like strings remain invalid; commit cannot proceed with error payload. | Existing parser/import tests. |
| Accidental demo import | Master Data template sheet has headers and validation only; synthetic examples exist only in Instructions. | Template parse rejects as empty. |
| Membership mutation succeeds without audit | Member create and status mutation write business row plus audit within one Prisma transaction. | PostgreSQL trigger failure tests require rollback. |
| SIMS manual state override | `PATCH /master-data/:id/active` rejects SIMS-managed records. | Integration negative case. |
| Stale/raw preview data | No raw workbook bytes are stored; expiry blocks commit. Parsed preview retention still requires operational purge. | MED-01 remains mandatory. |

No claim is made that hostile workbook code execution has been demonstrated. The corrected policy enforces the documented rejection boundary and has targeted regression cases; full hostile-file assurance needs dedicated security testing.

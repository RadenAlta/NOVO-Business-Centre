# Sprint 03 threat model — Master Data, Excel, and membership

The authenticated server determines tenant, actor, role, eligibility and SIMS ownership. Browser input cannot set those values. Sprint 03 test data is synthetic only.

| Threat | Control | Evidence / boundary |
| --- | --- | --- |
| Student-heavy directory hides eligible staff | Server endpoint scopes tenant and filters active `TEACHER`/`EMPLOYEE` before search and pagination. | PostgreSQL regression with 150 students; CI 4/4 reported passing for `28fa14a`. |
| ZIP entry lies about uncompressed size | Archive remains limited to 2 MiB upload, 10 MiB actual aggregate expansion, a 100:1 declared ratio, and 60 entries. Each entry is decompressed with a remaining-output cap; actual size must equal declared size before ExcelJS loads it. | Local parser regression falsifies a 1-byte declaration for a payload larger than the expansion cap. Hosted CI pending for this commit. |
| XML entity expansion or oversized relationship XML | Each `.rels` entry is bounded to 128 KiB and 100 relationship nodes; `DOCTYPE`, malformed XML and unexpected elements are rejected by SAX parsing. | Local API unit regressions cover `DOCTYPE` and oversized relationship XML. Hosted CI pending for this commit. |
| External relationship bypass | Every package relationship, including `_rels/.rels`, is parsed; decoded `TargetMode=External` is rejected independently of ExcelJS cell handling. | Local regressions cover encoded root `TargetMode`, a safe internal relationship, and ordinary worksheet hyperlink rejection. Hosted CI pending for this commit. |
| Formula outside data cells | Any formula anywhere in `Master Data` or `Instructions` rejects the workbook before preview. | Unit Instructions-sheet formula case. |
| Accidental demo import | Master Data template sheet has headers and validation only; synthetic examples exist only in Instructions. | Template parse rejects as empty. |
| Membership mutation succeeds without audit | Member create and active-state transition write business row plus audit in one Prisma transaction. | Hosted PostgreSQL trigger-failure tests passed at `28fa14a`. |
| SIMS manual state override | `PATCH /master-data/:id/active` rejects SIMS-managed records. | Hosted integration negative case passed at `28fa14a`. |
| Stale/raw preview data | No raw workbook bytes are stored; expiry blocks commit. Scheduled purge of expired structured preview data remains MED-01. | MED-01 remains OPEN and mandatory before production personal data. |

No claim is made that hostile workbook code execution has been demonstrated. The controls enforce documented rejection boundaries; a dedicated adversarial-file assessment remains outside this sprint.

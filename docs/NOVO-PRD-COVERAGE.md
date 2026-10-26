# NOVO PRD Coverage — Sprint 03 code-review corrections

Scope: PR #3 corrections after reviewed head `e636a6d`. The authoritative 86-row status remains [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); no requirement is promoted to `verified` by source review alone.

## Revised acceptance matrix

| Requirement | Acceptance criterion | Correction/evidence | Status |
| --- | --- | --- | --- |
| FR-003 Master Data | Student/teacher/employee CRUD, normalized uniqueness, tenant/RBAC boundary, search/paging, and non-destructive delete policy | New eligible-member API prevents a student-heavy directory from hiding teachers. SIMS activation is server-owned. Delete is documented soft deactivation to preserve history. | partial; CI pending |
| FR-004 Secure Excel Import | No accidental demo import; exact template; reject unsafe archive/cell content; user/tenant/expiry preview; atomic one-use commit | Examples only live in Instructions. Archive relationship scan rejects `TargetMode=External`; all-sheet cell scan rejects formulas/external links. Unit cases cover the new policy. | partial; CI pending |
| FR-005 Membership | Active same-tenant teacher/employee only, duplicate/student/inactive/foreign denial, lifecycle, audit and history | Create/status/audit are a single transaction. Trigger-based PostgreSQL tests prove rollback on audit failure. | partial; CI pending |

## Retained product boundary

Store/POS, Shuttle, Catering, Funding, Financing, Master Data, Membership, Reporting, SIMS and Backup remain tracked. Purchasing remains an extension. All 14 FR, 10 NFR, 20 Main Quest and 42 Side Quest rows remain in the roadmap.

## Verification limit

The reviewed correction code has local unit/build/lint/Prisma evidence. PostgreSQL integration, migration deployment, and CI are pending the correction commit; browser E2E, deployment, performance, backup/restore and real-data retention compliance remain outside this audit.

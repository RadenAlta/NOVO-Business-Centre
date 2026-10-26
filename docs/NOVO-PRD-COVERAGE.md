# NOVO PRD Coverage — Sprint 03 code-review corrections

Scope: PR #3 corrections through baseline `28fa14a`, plus uncommitted HIGH-06/HIGH-07 hardening. The authoritative 86-row status remains [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); no requirement is promoted to `verified` by source review alone.

## Revised acceptance matrix

| Requirement | Acceptance criterion | Correction/evidence | Status |
| --- | --- | --- | --- |
| FR-003 Master Data | Student/teacher/employee CRUD, normalized uniqueness, tenant/RBAC boundary, search/paging, and non-destructive delete policy | New eligible-member API prevents a student-heavy directory from hiding teachers. SIMS activation is server-owned. Delete is documented soft deactivation to preserve history. | partial; baseline CI passed at `28fa14a`; hardening CI pending |
| FR-004 Secure Excel Import | No accidental demo import; exact template; reject unsafe archive/cell content; user/tenant/expiry preview; atomic one-use commit | Examples only live in Instructions. Actual ZIP expansion is bounded before ExcelJS, all relationship files including package root are SAX-parsed, decoded `TargetMode=External` is rejected, and all-sheet cell policy rejects formulas/external links. Local parser cases cover the policy; hosted CI for this hardening is pending. | partial; CI pending |
| FR-005 Membership | Active same-tenant teacher/employee only, duplicate/student/inactive/foreign denial, lifecycle, audit and history | Create/status/audit are a single transaction. Trigger-based PostgreSQL tests prove rollback on audit failure. | partial; baseline CI passed at `28fa14a`; hardening CI pending |

## Retained product boundary

Store/POS, Shuttle, Catering, Funding, Financing, Master Data, Membership, Reporting, SIMS and Backup remain tracked. Purchasing remains an extension. All 14 FR, 10 NFR, 20 Main Quest and 42 Side Quest rows remain in the roadmap.

## Verification limit

The baseline correction code has owner-reported 4/4 hosted CI evidence at `28fa14a`. HIGH-06/HIGH-07 have local API type-check and parser-test evidence only; PostgreSQL integration, migration deployment, full build/lint and CI remain pending the hardening commit. Browser E2E, deployment, performance, backup/restore and real-data retention compliance remain outside this audit.

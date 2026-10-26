# NOVO PRD Coverage — Sprint 03 Master Data, Excel Import & Membership

This document records the Sprint 03 source and test surfaces on `codex/sprint-03-master-data-import`. It does **not** declare production readiness, user acceptance, or completed requirements. The authoritative 86-row status is [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Source surfaces inspected

| NOVO area | Sprint 02 source evidence | Audit status |
| --- | --- | --- |
| Authentication, tenants and roles | PostgreSQL `UserSession` migrations; opaque SHA-256-hashed session, revocation, current-user role lookup, tenant-match middleware, and stable concurrent `/me` CSRF issuance. | partial |
| Browser session security | HttpOnly cookie-only authentication; no browser bearer/session storage; stable memory-only CSRF, trusted-origin checks, per-principal query cache isolation/eviction, and retryable failed logout. | partial |
| Master data, Excel import and cooperative membership | Tenant-scoped paginated CRUD/status routes, user-confirmed Excel template/preview/commit, one-time fingerprinted import previews, SIMS skip policy, and active teacher/employee-only memberships. The `MasterDataImportPreview` migration keeps raw workbooks out of persistence. | partial |
| Store/POS and inventory | Product, stock and sale schema/routes/screens, including transactional sale source. | partial |
| Shuttle | Subscription, invoice, payment and settlement schema/routes/screens. | partial |
| Catering | Catering order routes/screens. | partial |
| Funding | Savings-account and append-only ledger source. | partial |
| Financing and purchasing extension | Financing/receivable source and separately named purchasing extension. | partial |
| Attachments and audit | Signature/hash validation and tenant-scoped download source; integration suite defines authenticated multipart upload. | partial |
| Reporting and dashboard | Web reporting surface plus Streamlit dashboard/CSV workflow. | partial |
| ML, generative AI and RAG | FastAPI service, original TF-IDF models, model comparison/evaluation and optional RAG/provider paths. | partial |
| SIMS sync, backup/restore | No qualifying adapter/drill was observed. | not-started |

## Requirements retained from the PRDs

The original NOVO modules—Store, Shuttle, Catering, Funding, Financing, master data, membership, reporting, SIMS sync and backup—remain intact. Purchasing is still an extension, not a replacement. All 14 functional, 10 non-functional, 20 Main Quest and 42 Side Quest entries remain tracked in the implementation-status and quest-traceability documents.

## Sprint 02 integration coverage designed

`apps/api/src/security.integration.test.ts` is designed to run only against a disposable `novo_ci` or `novo_test` PostgreSQL database. It covers:

- first-workspace bootstrap, cookie flags, no token JSON response and hash-only session persistence;
- cookie `/me` restoration, stable overlapping-CSRF responses, logout revocation, and replay rejection;
- bearer-only, altered-cookie and expired-session rejection;
- missing/invalid CSRF, foreign origin, valid mutation and multipart attachment upload;
- cross-tenant read/write denial, role change after login, and inactive account rejection.

The CI API/Web job provisions PostgreSQL 16, applies committed Prisma migrations, and runs build, all workspace Vitest suites, and lint. At PR head `91b0a23`, GitHub CLI reported both API/Web checks and both ML checks successful (4/4; push run `40196407790`, PR run `40196411378`). This verifies the CI-executed scenarios, not every end-to-end NOVO function or deployment configuration.

## Verification limits and remaining gaps

- Local pnpm/Prisma/test/lint commands are blocked by the workspace sandbox's project-store symlink `EPERM`; Docker/PostgreSQL are unavailable here.
- No browser E2E, deployment, production backup/restore, SIMS-unavailability, accessibility, performance, or external-channel test has been observed.
- The CSRF/origin/session controls, per-principal client cache isolation, and retryable logout UX are source-implemented but not security certification. Confirm PR checks, deployment TLS/CORS configuration, object-storage malware scanning, and a production threat review before release.

## Sprint 03 acceptance boundary

`apps/api/src/security.integration.test.ts` covers synthetic Master Data CRUD, normalized duplicate-key rejection, tenant/RBAC boundaries, student/inactive membership denial, Excel template/preview/no-write, update, SIMS skip, tampered/replayed preview, formula and corrupted-workbook cases. `apps/api/src/master-data-import.test.ts` now also proves the exact template header contract, Unicode/whitespace normalization, duplicate normalized keys, and wrong-header rejection. CI run `40291860500` failed in these two fixtures after build/lint completed; the local correction passes its focused unit suite, build, lint, Prisma client generation, and schema validation. PostgreSQL-backed tests remain blocked locally, so all Sprint 03 evidence remains `partial`, not `verified`.
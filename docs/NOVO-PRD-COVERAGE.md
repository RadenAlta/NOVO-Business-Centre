# NOVO PRD Coverage — Sprint 01 Baseline Audit

This document records what was observed in source on `codex/sprint-01-foundation`. It does **not** declare production readiness, user acceptance, or a completed requirement. Authoritative per-requirement status is in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Source surfaces inspected

| NOVO area | Static source evidence observed | Audit status |
| --- | --- | --- |
| Authentication, tenants and roles | Express authentication middleware, JWT/cookie handling, tenant-bound active-user lookup and role middleware. | partial |
| Master data and cooperative membership | Prisma models/routes for users, membership and master data. | partial |
| Store/POS and inventory | Product, stock and sale schema/routes/screens, including transactional sale source. | partial |
| Shuttle | Subscription, invoice, payment and settlement schema/routes/screens. | partial |
| Catering | Catering order routes/screens. | partial |
| Funding | Savings-account and append-only ledger source. | partial |
| Financing and purchasing extension | Financing/receivable source and separately named purchasing extension. | partial |
| Attachments and audit | Attachment validation/signature/hash code and audit-model surface. | partial |
| Reporting and dashboard | Web reporting surface plus Streamlit dashboard/CSV workflow. | partial |
| ML, generative AI and RAG | FastAPI service, original TF-IDF models, model comparison/evaluation and optional RAG/provider paths. | partial |
| SIMS sync, backup/restore | No qualifying adapter/drill was observed. | not-started |

## Requirements retained from the PRDs

The audit preserves the original NOVO modules—Store, Shuttle, Catering, Funding, Financing, master data, membership, reporting, SIMS sync and backup. Purchasing is documented as an extension rather than a replacement for those modules. The 14 functional and 10 non-functional requirements remain tracked individually in `IMPLEMENTATION_STATUS.md`.

## Verification limits and known gaps

- Dependencies could not install because this sandbox blocks pnpm project-store symlink creation (`EPERM`, exit `-4048`).
- Bundled Python compiled all ML source and test modules successfully, but has no installed `pytest` or ML dependencies; pytest, FastAPI startup, PostgreSQL migrations and Compose validation could not run.
- No browser end-to-end flow, deployment, production backup/restore, SIMS unavailability test, accessibility test, performance measurement or external-channel test was observed.
- The source contains a bearer/sessionStorage compatibility path, no server-side revocation and no demonstrated CSRF defense. See `docs/SECURITY.md`.

## What a later sprint must prove

Use a normal local/CI runtime to run install, database generation/migration, API/web build/lint/test, Python compilation/pytest and at least one tenant/RBAC negative test. Only then promote individual rows from `partial` or `blocked` to `verified` with the exact evidence.

## CI evidence and test-baseline correction

The supplied current PR log is GitHub Actions run `40155523749` (`pull_request`, SHA `ca876c3…`). It shows that `pnpm install --frozen-lockfile`, Prisma generation and the monorepo build completed far enough for the workflow to run `pnpm test`. The test stage then failed because `@novo/contracts` ran `vitest run` with no test files. This supersedes the previous ignored-build issue as the current API/Web blocker.

Contracts now has deterministic runtime tests for the API prefix, the exact unique operator-role list, and the absence of a `STUDENT` operator role. Web now has deterministic mocked-fetch tests for credentialed JSON requests, HTTP 204 handling and API-error propagation. Existing API helper tests remain in place. No test script was removed and neither Vitest nor its no-test failure behavior was disabled.

Both ML checks passed on SHA `ca876c3` according to the reviewed logs and were not changed. The supplied push failure did not include a current error log, so no claim is made about its cause. The new Contracts/Web tests have passed source syntax checks only in this sandbox; their Vitest execution and the next CI run remain required before any feature requirement is marked verified.

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

## CI evidence and pnpm build-script correction

The reviewed latest GitHub Actions logs establish the following actual outcomes:

- Both `ml` jobs (push and pull request) **PASS** after the earlier CPU-only PyTorch correction. This confirms only the CI ML job; it does not promote any product or RAG requirement to `verified`.
- Both latest `api-and-web` jobs fail at `pnpm install --frozen-lockfile` with `ERR_PNPM_IGNORED_BUILDS` for `@prisma/client@6.19.3`, `@prisma/engines@6.19.3`, `prisma@6.19.3`, and `esbuild@0.28.2`. No Prisma generation, application build, or API/web test ran after that failure.

`pnpm-workspace.yaml` now has a reviewed, exact `allowBuilds` policy for only those four required packages. It preserves the workspace package list, pnpm 11.25.0 root source of truth, frozen-lockfile CI step, and meaningful Prisma/build/test stages. It does not use `dangerouslyAllowAllBuilds`, `--ignore-scripts`, `pnpm approve-builds --all`, a wildcard, or a lockfile update.

The local Codex pnpm commands still stop earlier with a sandbox project-store symlink `EPERM`, so no additional ignored-build package could be observed locally. The next push to PR #1 must provide the first CI evidence for this exact allowlist change.

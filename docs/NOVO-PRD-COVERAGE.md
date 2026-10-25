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

## CI evidence and test baseline (25 October 2026)

The repository owner supplied the passing GitHub CLI checks for commit `5210332`: `push` run `40156431701` and `pull_request` run `40156434593`, with `api-and-web` and `ml` passing on both triggers (**4/4 PASS**). The earlier pnpm/policy and Vitest-discovery blockers are resolved in those checks.

Unit tests cover Contracts API/role invariants, Web API fetch responses/errors, existing API helpers, and ML retrieval fallback; this is useful baseline coverage, not complete feature verification. The CI configuration does not execute `pnpm lint`, browser E2E, PostgreSQL/Prisma migrations, production backup/restore, tenant/RBAC negative integration cases, or the separate full Chroma embedding smoke test. Those remain future acceptance gates.

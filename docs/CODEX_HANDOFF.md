# CODEX Handoff — Sprint 01 Foundation (final review)

## Scope and Git checkpoint

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Pull request: [PR #1](https://github.com/RadenAlta/NOVO-Business-Centre/pull/1), `codex/sprint-01-foundation` → `main`.
- Reviewed application and documentation commit: `52103320ef5904ef56ac6cf3185270a22c57534f`.
- Scope: source audit, 86-requirement traceability, CI repairs, CPU-only ML installation, and baseline Contracts/Web/ML tests. No Sprint 02 authentication changes have started.

## GitHub Actions result for `5210332`

The repository owner supplied `gh run list` and `gh pr checks 1 --watch` output on 25 October 2026. Both GitHub Actions workflow runs completed successfully:

| Trigger | Run ID | `api-and-web` | `ml` |
| --- | --- | --- | --- |
| `push` | `40156431701` | **PASS** | **PASS** |
| `pull_request` | `40156434593` | **PASS** | **PASS** |

**Result: 4/4 checks passing, 0 failing, 0 pending.** This establishes that the configured CI jobs pass for the referenced commit. It is not evidence that all 86 product requirements work end-to-end, or that production deployment, database migrations, browser E2E, or full vector-based RAG have been tested.

## Changes included in PR #1

- `.github/workflows/ci.yml`: use the root `packageManager` version of pnpm; install CPU-only PyTorch before ML requirements and assert that CUDA is absent.
- `pnpm-workspace.yaml`: explicitly allow install/build scripts for only `@prisma/client`, `@prisma/engines`, `prisma`, and `esbuild`.
- `services/ml/Dockerfile` and `services/ml/README.md`: document and use the CPU-only install path.
- `services/ml/tests/test_rag.py`: lightweight lexical retrieval and provider-less fallback tests.
- `services/ml/scripts/smoke_rag_embedding.py`: explicit, separate Chroma/embedding smoke test; **not run as part of CI**, and may download a model.
- `packages/contracts/src/index.test.ts`: test API prefix, operator roles, uniqueness, and exclusion of the `STUDENT` role.
- `apps/web/src/api.test.ts`: test credentialed JSON requests, 204 responses, and API error propagation with a mocked `fetch`.
- `docs/IMPLEMENTATION_STATUS.md`, `docs/QUEST-TRACEABILITY.md`, `docs/NOVO-PRD-COVERAGE.md`, and `docs/SECURITY.md`: source coverage, requirements tracking, and security limitations.

## Validation boundaries and open work

- The normal GitHub Actions `api-and-web` job runs dependency installation, Prisma Client generation, monorepo build, and Vitest via `pnpm test`; the `ml` job imports RAG dependencies and runs `pytest` with CPU-only PyTorch. The CI configuration **does not currently run `pnpm lint`**.
- Local Codex checks of pnpm remain blocked by project-store symlink `EPERM`; Docker and PostgreSQL runtime validation were not demonstrated. Git operations also needed the repository owner's normal PowerShell because Codex could not create `.git/index.lock`.
- The full embedding-backed Chroma smoke script is outside CI; provider-backed generation and broader RAG evaluation remain unverified.
- API/Web unit tests do not replace integration or negative security tests. The browser still stores a bearer token in `sessionStorage`, logout cannot revoke the copied bearer server-side, and cookie-authenticated mutations need explicit CSRF/origin defenses. These are Sprint 02 work and prevent production/security sign-off.
- SIMS sync, attachment/DB backup and restore, production deploy, tenant isolation and RBAC negative cases, performance, accessibility and browser E2E are not proved by this sprint.

## Requirement status and merge decision

The original 14 FR + 10 NFR + 20 Main Quest + 42 Side Quest remain in scope. The conservative audit baseline is **0 verified, 70 partial, 6 blocked, 10 not-started**. A passing CI baseline does not automatically promote whole product requirements to `verified`.

The four CI checks have passed. The repository owner should review the final docs-only correction, push it to **PR #1**, confirm the latest checks again, and only then merge to `main`. After merge, Sprint 02 can implement revocable server-side sessions, CSRF/origin protection, tenant isolation, RBAC negative tests, and accompanying migration/test coverage.

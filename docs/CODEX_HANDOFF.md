# CODEX Handoff — Sprint 02 Authentication & Security

## Scope and checkpoint

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch: `codex/sprint-02-auth-security`.
- Starting checkpoint: `479f725` (`wip: checkpoint Sprint 02 authentication security`).
- Target: Draft PR #2 from `codex/sprint-02-auth-security` to `main`; do **not** merge automatically.
- Scope: revocable browser sessions, cookie-only authentication, CSRF/origin protection, current RBAC/account/tenant checks, PostgreSQL migration/integration tests, CI, and truthful 86-requirement traceability. No Sprint 03 work is included.

## Implemented source changes

- `apps/api/prisma/schema.prisma` and migration `202610250002_server_sessions`: add `UserSession` with user/tenant binding, SHA-256 token hash, CSRF hash, expiry, revocation and indexes.
- `apps/api/src/auth.ts`: random 256-bit opaque browser sessions; no JWT verification or bearer extraction; current-user account/role lookup; tenant match; logout revocation; CSRF and exact-origin middleware.
- `apps/api/src/app.ts`: bootstrap/login set only the HttpOnly cookie and return `{user, tenant, csrfToken}`; `/me` restores a session; logout is idempotent after a missing/revoked cookie; all protected mutations run through CSRF/origin middleware.
- `apps/web/src/api.ts`, `App.tsx`, and `pages.tsx`: remove `sessionStorage` and Authorization bearer handling; use credentialed fetch, in-memory CSRF, `/me` restoration, 401 state clearing, and FormData-safe headers.
- `apps/api/src/security.integration.test.ts`: real-PostgreSQL integration scenarios for session lifecycle/replay, invalid credentials, CSRF/origin, RBAC/account state, tenant isolation, and multipart upload. `apps/web/src/api.test.ts` now asserts cookie/CSRF and multipart client behavior.
- `.github/workflows/ci.yml`: disposable PostgreSQL 16, Prisma migration deploy, build, test and lint. API and contracts now have typecheck lint scripts.
- Documentation: `SECURITY.md`, `API-CONTRACT.md`, `IMPLEMENTATION_STATUS.md`, `QUEST-TRACEABILITY.md`, and `NOVO-PRD-COVERAGE.md` no longer claim the old bearer path remains and retain all 86 requirements conservatively.

## Validation record for this continuation

| Check | Status | Evidence / reason |
| --- | --- | --- |
| Git status at resume | PASS | Clean branch at checkpoint `479f725`, tracking `origin/codex/sprint-02-auth-security`. |
| Static source/diff review | PASS | Session migration, auth middleware, web client and integration test are present and reviewed. |
| `pnpm install --frozen-lockfile` | BLOCKED | Sandbox cannot create the pnpm project-store symlink (`EPERM`), so it cannot install/generate dependencies. |
| Prisma generation/migration | BLOCKED | Requires pnpm/runtime and PostgreSQL; CI now supplies a disposable service. |
| `pnpm build`, `pnpm test`, `pnpm lint` | BLOCKED | Dependency/runtime blocker above; no local result is claimed. |
| CI `api-and-web` after Sprint 02 | PENDING | New workflow has not yet been observed on the Sprint 02 commit. |
| ML CI | UNCHANGED | Sprint 02 does not alter ML source; do not claim a fresh result until the PR run reports it. |

## Required owner/CI follow-up

1. Review the working-tree diff and commit it on `codex/sprint-02-auth-security`.
2. Push the branch, create Draft PR #2 to `main`, and wait for both `api-and-web` and `ml` checks.
3. If `api-and-web` fails, use its first actual error to make a focused correction. A successful workflow is required before changing any affected requirement row to `verified`.
4. Before production, use HTTPS, configure the exact `WEB_ORIGIN`, provide private attachment storage/malware scanning, and exercise backup/restore separately.

## Explicit non-claims

The 86 requirements remain tracked; this handoff does not claim 86/86, 62/62, capstone completion, production security certification, database persistence proof, or automatic merging. Do not start Sprint 03 before owner review of the Draft PR.
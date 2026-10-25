# CODEX Handoff — Sprint 02 / Draft PR #2 correction

## Scope and Git checkpoint

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch and Draft PR: `codex/sprint-02-auth-security` → `main`, [PR #2](https://github.com/RadenAlta/NOVO-Business-Centre/pull/2). Do **not** merge automatically.
- Starting correction commit: `2645d057b250bf2f88edb60d84a931c859ca1ff5`.
- Confirmed prior CI evidence: push `40192601821` and PR `40192607037` failed only in `api-and-web` during `pnpm build`; both ML jobs passed. Sprint 03 is out of scope.

## Root causes and corrections

| Finding | Cause at `2645d05` | Correction in this workspace |
| --- | --- | --- |
| Web TS6133 | `DemandForecast` accepted `session` but did not read it. | Remove the unused prop and caller binding without changing forecast input. |
| API TS2345 | `request.agent(app)` inferred `TestAgent<Test>` was incompatible with `request.SuperAgentTest` in the test helper. | Type `login` with `ReturnType<typeof request.agent>`; cookie-persisting agent behavior is unchanged. |
| `/me` CSRF race | Each GET rotated `csrfTokenHash`; overlapping reads could invalidate an earlier response. | Add migration `202610250003_stable_csrf_token`, persist one non-authentication CSRF value per session, and atomically backfill legacy null values. Raw session tokens remain SHA-256-hashed only. |
| React Query cache leak | Keys were tenant-only and the app-level QueryClient outlived user sessions. | Scope keys by tenant/user/role, pass query abort signals, and cancel/remove all protected queries on sign-in, logout and unauthentication. |
| Logout UX | A `finally` cleared UI state even when server revocation/network failed. | Confirm logout before clearing state; 401 means already invalidated, while network/5xx retains state and shows an actionable retry message. |

## Changed paths

- API/database: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/202610250003_stable_csrf_token/migration.sql`, `apps/api/src/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/security.integration.test.ts`.
- Web: `apps/web/src/App.tsx`, `apps/web/src/pages.tsx`, `apps/web/src/session-cache.ts`, `apps/web/src/logout.ts`, and their regression tests.
- Documentation: `docs/SECURITY.md`, `docs/API-CONTRACT.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/NOVO-PRD-COVERAGE.md`, `docs/QUEST-TRACEABILITY.md`, this handoff.

## Regression coverage added

- PostgreSQL integration: two overlapping `/me` calls against a legacy-compatible session return usable CSRF values, and both values authorize later writes. Existing integration coverage retains logout replay, expiry, role change, inactive account, cross-tenant write, CSRF/origin, and multipart cases.
- Web unit: two same-tenant users receive different protected query keys; protected cache removal is asserted; successful server logout, network/5xx unconfirmed logout, and already-invalid 401 logout are distinguished.

## Validation record

| Check | Status | Observed evidence |
| --- | --- | --- |
| Branch/checkpoint review | PASS | Clean branch began at `2645d05`; no history was rewritten. |
| `git diff --check` / package JSON validation | PASS | No whitespace errors; package JSON parses; all 86 requirement IDs remain unique (14 FR, 10 NFR, 20 Main Quest, 42 Side Quest). |
| `pnpm install --frozen-lockfile` | BLOCKED locally | Sandbox pnpm project-store symlink `EPERM`. |
| `pnpm db:generate`, `pnpm build`, `pnpm test`, `pnpm lint` | BLOCKED locally | Same dependency/runtime blocker; prior CI build failed before tests/lint. |
| PostgreSQL integration suite | PENDING | CI is configured to migrate disposable PostgreSQL; no fresh CI observation yet. |
| ML jobs | Prior PASS | Preserved unchanged; await fresh PR #2 checks for new evidence. |

## Review and owner commands

Run these in ordinary Windows PowerShell from the repository after reviewing the diff:

```powershell
Set-Location C:\Users\raden\dev\projects\NOVO-Business-Centre
git add -- apps/api/prisma/schema.prisma apps/api/prisma/migrations/202610250003_stable_csrf_token/migration.sql apps/api/src/auth.ts apps/api/src/app.ts apps/api/src/security.integration.test.ts apps/web/src/App.tsx apps/web/src/pages.tsx apps/web/src/session-cache.ts apps/web/src/session-cache.test.ts apps/web/src/logout.ts apps/web/src/logout.test.ts docs/SECURITY.md docs/API-CONTRACT.md docs/IMPLEMENTATION_STATUS.md docs/NOVO-PRD-COVERAGE.md docs/QUEST-TRACEABILITY.md docs/CODEX_HANDOFF.md
git commit -m "fix: harden Sprint 02 session regressions"
git push origin codex/sprint-02-auth-security
```

Then review the existing Draft PR #2 and its new `api-and-web` and `ml` checks. Only observed passing migration/test results can promote requirement rows from `partial` or `blocked` to `verified`.

## Explicit non-claims

All 86 requirement IDs remain tracked exactly once. This correction does not claim production readiness, 86/86 completion, capstone completion, a passing fresh CI run, or automatic merge.
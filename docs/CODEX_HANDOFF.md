# CODEX Handoff — Sprint 02 / PR #2 final CI evidence

## Scope and Git checkpoint

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch and Draft PR: `codex/sprint-02-auth-security` → `main`, [PR #2](https://github.com/RadenAlta/NOVO-Business-Centre/pull/2). Do **not** merge automatically.
- Final reviewed PR head: `91b0a23bc49b0d137a70fb096594e5933649ed9b` (`test: correct CSRF assertion after unauthorized response`).
- Confirmed current CI evidence, reported from GitHub CLI: push `40196407790` and PR `40196411378` both completed with API/Web and ML checks passing (4/4). The required API/Web workflow runs disposable PostgreSQL 16, Prisma migration, build, all workspace Vitest suites, and lint in order. Sprint 03 is out of scope.

## Root causes and corrections

| Finding | Cause at `2645d05` | Correction in this workspace |
| --- | --- | --- |
| Web TS6133 | `DemandForecast` accepted `session` but did not read it. | Remove the unused prop and caller binding without changing forecast input. |
| API TS2345 | `request.agent(app)` inferred `TestAgent<Test>` was incompatible with `request.SuperAgentTest` in the test helper. | Type `login` with `ReturnType<typeof request.agent>`; cookie-persisting agent behavior is unchanged. |
| `/me` CSRF race | Each GET rotated `csrfTokenHash`; overlapping reads could invalidate an earlier response. | Add migration `202610250003_stable_csrf_token`, persist one non-authentication CSRF value per session, and atomically backfill legacy null values. Raw session tokens remain SHA-256-hashed only. |
| React Query cache leak | Keys were tenant-only and the app-level QueryClient outlived user sessions. | Scope keys by tenant/user/role, pass query abort signals, and cancel/remove all protected queries on sign-in, logout and unauthentication. |
| Logout UX | A `finally` cleared UI state even when server revocation/network failed. | Confirm logout before clearing state; 401 means already invalidated, while network/5xx retains state and shows an actionable retry message. |
| Web logout assertion | The 401 regression expected JSON `Content-Type` on a bodyless `POST /auth/logout`, although the client correctly sends no body or content type. | Assert the intended request contract: credentialed POST, CSRF used before the 401, then no CSRF and no JSON content type after the 401. Production client code is unchanged. |

## Changed paths

- API/database: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/202610250003_stable_csrf_token/migration.sql`, `apps/api/src/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/security.integration.test.ts`.
- Web: `apps/web/src/App.tsx`, `apps/web/src/pages.tsx`, `apps/web/src/session-cache.ts`, `apps/web/src/logout.ts`, `apps/web/src/api.test.ts`, and their regression tests.
- Documentation: `docs/SECURITY.md`, `docs/API-CONTRACT.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/NOVO-PRD-COVERAGE.md`, `docs/QUEST-TRACEABILITY.md`, this handoff.

## Regression coverage added

- PostgreSQL integration: two overlapping `/me` calls against a legacy-compatible session return usable CSRF values, and both values authorize later writes. Existing integration coverage retains logout replay, expiry, role change, inactive account, cross-tenant write, CSRF/origin, and multipart cases.
- Web unit: two same-tenant users receive different protected query keys; protected cache removal is asserted; successful server logout, network/5xx unconfirmed logout, and already-invalid 401 logout are distinguished.
- Web API client: a pre-401 JSON POST carries memory-only CSRF; the next bodyless logout POST remains credentialed but carries neither CSRF nor `Content-Type`.

## Validation record

| Check | Status | Observed evidence |
| --- | --- | --- |
| Git checkpoint | PASS | PR #2 head at `91b0a23`, based on the existing Sprint 02 branch; no history rewrite or merge. |
| `git diff --check` / package JSON validation | PASS | No whitespace errors; package JSON parses; all 86 requirement IDs remain unique (14 FR, 10 NFR, 20 Main Quest, 42 Side Quest). |
| Hosted CI at `91b0a23` | PASS | GitHub CLI reports 4/4 successful jobs: API/Web push and pull_request, ML push and pull_request; runs `40196407790` and `40196411378`. |
| `pnpm install --frozen-lockfile` | BLOCKED locally | Sandbox pnpm project-store symlink `EPERM`. |
| `pnpm db:generate`, `pnpm build`, `pnpm test`, `pnpm lint` | BLOCKED locally | Same dependency/runtime blocker. |
| PostgreSQL migration and integration suite | PASS (hosted CI) | Mandatory migration and `pnpm test` steps precede the successful API/Web job completion. Full test totals were not independently captured in this handoff. |
| ML jobs | PASS (hosted CI) | Both push and PR ML checks passed on the current PR head; no ML source changes were introduced in this correction. |

## Review and owner commands

Run these in ordinary Windows PowerShell from the repository after reviewing the diff:

```powershell
Set-Location C:\Users\raden\dev\projects\NOVO-Business-Centre
git diff --check
git add -- docs/CODEX_HANDOFF.md docs/IMPLEMENTATION_STATUS.md docs/NOVO-PRD-COVERAGE.md docs/QUEST-TRACEABILITY.md docs/SECURITY.md
git diff --cached --check
git commit -m "docs: record Sprint 02 final CI evidence"
git push origin codex/sprint-02-auth-security
gh pr checks 2 --repo RadenAlta/NOVO-Business-Centre --watch
```

After the documentation-only commit passes its own GitHub checks, review PR #2 before explicitly marking it ready and merging. A successful security-focused CI suite does not prove every product requirement or production configuration.

## Explicit non-claims

All 86 requirement IDs remain tracked exactly once. Current hosted CI is 4/4 PASS, but this does not claim production readiness, 86/86 functional completion, a full browser E2E audit, capstone completion, or an automatic merge.
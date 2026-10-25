# CODEX Handoff — Sprint 01 Foundation / Contracts and Web test baseline

## Current checkpoint

- Branch: `codex/sprint-01-foundation`
- Existing pull request: [PR #1](https://github.com/RadenAlta/NOVO-Business-Centre/pull/1) (`codex/sprint-01-foundation` → `main`)
- Reviewed baseline: `ca876c3e467354bb986d77d2215130f61700f848` — `ci: approve required pnpm build scripts`
- Scope: fix the CI test-discovery failure, add meaningful package-level unit tests, and preserve Sprint 01 evidence. Sprint 02 has not started.

## Confirmed current CI evidence

GitHub Actions PR run `40155523749` (`pull_request`, SHA `ca876c3…`) reached `pnpm test` after installation, Prisma generation, and build. It failed here:

```text
packages/contracts test$ vitest run
No test files found, exiting with code 1
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @novo/contracts@0.1.0 test: `vitest run`
```

This replaces the earlier ignored-build issue as the current API/Web blocker. Both ML checks passed on SHA `ca876c3` and are unchanged. A new push failure exists, but no current failed-log detail for it was supplied, so its cause is not claimed.

## Changes prepared

- `packages/contracts/src/index.test.ts`
  - Tests actual runtime contract invariants: `/api/v1`, the complete expected `userRoles` constants, role uniqueness, and the absence of a `STUDENT` cooperative-operator role.
- `apps/web/src/api.test.ts`
  - Uses cleaned-up mocked `fetch` to test credentialed JSON requests/custom headers, HTTP 204 handling, and propagation of API status/code/message. It does not test or endorse session persistence.
- `apps/api/src/lib.test.ts`
  - Remains intact; it already tests number conversion and unique business references.
- `docs/IMPLEMENTATION_STATUS.md`, `docs/NOVO-PRD-COVERAGE.md`, and this handoff
  - Record the true CI/test status without promoting any product requirement.

Every monorepo package with `"test": "vitest run"` now has a discoverable `*.test.ts` file. No `passWithNoTests`, skipped/empty suite, `|| true`, disabled Vitest, or test-script removal was added.

## Actual validation in this session

| Command / check | Result |
| --- | --- |
| Node `--check packages/contracts/src/index.test.ts` | **PASS**, exit 0; syntax only. |
| Node `--check apps/web/src/api.test.ts` | **PASS**, exit 0; syntax only. |
| Static test discovery | **PASS**: Contracts, Web, and API each have one discoverable `*.test.ts` file and a `vitest run` script. |
| `pnpm install --frozen-lockfile` | **BLOCKED**, exit `-4048`: sandbox denies pnpm project-store symlink creation before dependencies/test scripts run. |
| `pnpm db:generate`, `pnpm build`, `pnpm test`, `pnpm lint` | **BLOCKED**, exit `1`: same sandbox symlink failure during pnpm dependency-status install. |
| `pnpm --filter @novo/contracts test` | **BLOCKED**, exit `1`: same sandbox failure before Vitest starts. |
| `pnpm --filter @novo/web test` | **BLOCKED**, exit `1`: same sandbox failure before Vitest starts. |
| `pnpm --filter @novo/api test` | **BLOCKED**, exit `1`: same sandbox failure before Vitest starts. |
| Git staging in Codex | **BLOCKED**, git add exit 128: sandbox cannot create .git/index.lock (Permission denied); no commit or push occurred. |

## Requirement traceability

All 86 canonical IDs remain once each: `verified` 0, `partial` 70, `blocked` 6, `not-started` 10. Package syntax/discovery checks and passing ML jobs are not end-user feature tests, so no FR, NFR, Main Quest, or Side Quest was promoted to `verified`.

## Next review gate

Commit and push this test baseline to update PR #1. The next PR workflow must show Contracts, Web and API Vitest execution, rather than `No test files found`. Only a completed current CI run can establish whether the new tests and remaining API/Web suites pass. Do not merge the PR or start Sprint 02.

## Safe owner PowerShell checkpoint

The Codex sandbox did reject `.git/index.lock` on this checkpoint; do not reset or clean the repository. From the already-authenticated owner PowerShell:

```powershell
Set-Location 'C:\Users\raden\dev\projects\NOVO-Business-Centre'
git switch codex/sprint-01-foundation
git status -sb
git diff --check
git diff --stat
git add -- packages/contracts/src/index.test.ts apps/web/src/api.test.ts docs/IMPLEMENTATION_STATUS.md docs/NOVO-PRD-COVERAGE.md docs/CODEX_HANDOFF.md
git diff --cached --check
git diff --cached
git commit -m "test: establish contracts and web baseline coverage"
git push origin codex/sprint-01-foundation
& "C:\Program Files\GitHub CLI\gh.exe" pr checks 1 --repo RadenAlta/NOVO-Business-Centre
& "C:\Program Files\GitHub CLI\gh.exe" run list --repo RadenAlta/NOVO-Business-Centre --branch codex/sprint-01-foundation --limit 5
```

That push updates PR #1 only. If CI fails again, use `gh run view <RUN_ID> --repo RadenAlta/NOVO-Business-Centre --log-failed` and address the concrete new error before changing test configuration.

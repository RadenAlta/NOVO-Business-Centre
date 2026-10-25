# CODEX Handoff — Sprint 01 Foundation / pnpm build-script correction

## Current checkpoint

- Branch: `codex/sprint-01-foundation`
- Existing pull request to update: [PR #1](https://github.com/RadenAlta/NOVO-Business-Centre/pull/1) (`codex/sprint-01-foundation` → `main`)
- Baseline correction commit: `ba243eb` — `ci: use CPU-only ML dependencies`
- Scope: correct pnpm 11 lifecycle-script approval for API/Web CI and keep Sprint 01 traceability factual. No Sprint 02 work or new product feature is included.

## Confirmed latest GitHub Actions evidence

The reviewed push and pull-request logs show:

| Job | Push | Pull request | Actual result |
| --- | --- | --- | --- |
| `ml` | PASS | PASS | The earlier CPU-only PyTorch correction removed the CUDA/NVIDIA disk-quota failure. Do not modify this job in this correction. |
| `api-and-web` | FAIL | FAIL | `pnpm install --frozen-lockfile` stops with `ERR_PNPM_IGNORED_BUILDS` for `@prisma/client@6.19.3`, `@prisma/engines@6.19.3`, `esbuild@0.28.2`, and `prisma@6.19.3`. Prisma generation, build, and tests did not run. |

The previous pnpm version conflict is not the current failure. The current failure is the four-package lifecycle/build-script policy.

## Change prepared in this checkpoint

`pnpm-workspace.yaml` preserves its workspace package declarations and adds only:

```yaml
allowBuilds:
  "@prisma/client": true
  "@prisma/engines": true
  esbuild: true
  prisma: true
```

This is a least-privilege allowlist for the packages named by the CI log. It does not set `dangerouslyAllowAllBuilds`, disable scripts, use `pnpm approve-builds --all`, alter dependency versions, alter `pnpm-lock.yaml`, or permit a wildcard. `package.json` remains the single pnpm version source (`pnpm@11.25.0`) and `.github/workflows/ci.yml` still runs install, Prisma generation, build and test for API/Web while retaining the passing ML job.

## Actual local verification

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | **BLOCKED**, exit `-4048`: sandbox denies pnpm project-store symlink creation before dependencies/build scripts are processed. |
| `pnpm db:generate` | **BLOCKED**, exit `1`: same sandbox symlink failure during pnpm dependency-status install. |
| `pnpm build` | **BLOCKED**, exit `1`: same sandbox symlink failure before build execution. |
| `pnpm test` | **BLOCKED**, exit `1`: same sandbox symlink failure before test execution. |
| `pnpm lint` | **BLOCKED**, exit `1`: same sandbox symlink failure before lint execution. |
| Static policy review | **PASS**: root `packageManager` is `pnpm@11.25.0`; the workflow declares no second pnpm version; allowlist has exactly the four packages from the CI error and no unsafe global option. |
| Git staging in Codex | **BLOCKED**, git add exit 128: sandbox cannot create .git/index.lock (Permission denied). No commit or push was attempted after staging failed. |

Because local pnpm stopped before package installation, it did not report any additional ignored-build dependency. Do not expand the allowlist without a concrete future CI error and package review.

## Requirement traceability

The 86 official IDs remain unchanged and each appears exactly once: `verified` 0, `partial` 70, `blocked` 6, `not-started` 10. The two passing ML CI jobs do not by themselves demonstrate an end-user behavior, so no requirement was promoted to `verified`.

## Next review gate

Push this exact allowlist to update PR #1, then inspect both API/Web runs. Success must show that the ignored-build error is gone and must separately show whether Prisma generation, build, test, and lint pass. Do not merge PR #1 or start Sprint 02.

## Safe owner PowerShell checkpoint

The Codex sandbox did reject `.git/index.lock` on this checkpoint; it must not be reset or cleaned. From the already-authenticated owner PowerShell:

```powershell
Set-Location 'C:\Users\raden\dev\projects\NOVO-Business-Centre'
git switch codex/sprint-01-foundation
git status --short
git diff --check
git diff --stat
git add -- pnpm-workspace.yaml docs/IMPLEMENTATION_STATUS.md docs/NOVO-PRD-COVERAGE.md docs/CODEX_HANDOFF.md
git diff --cached --check
git diff --cached
git commit -m "ci: approve required pnpm build scripts"
git push origin codex/sprint-01-foundation
& "C:\Program Files\GitHub CLI\gh.exe" pr checks 1 --repo RadenAlta/NOVO-Business-Centre
& "C:\Program Files\GitHub CLI\gh.exe" run list --repo RadenAlta/NOVO-Business-Centre --branch codex/sprint-01-foundation --limit 5
```

The push updates existing PR #1 only. If API/Web fails again, obtain the real failed log with `gh run view <RUN_ID> --repo RadenAlta/NOVO-Business-Centre --log-failed` before changing the allowlist further.

# CODEX Handoff — Sprint 03 test-fixture correction checkpoint

## Git state

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch: `codex/sprint-03-master-data-import`.
- Base: `main` at `671f049`; current committed checkpoint: `8b1041b`.
- CI failure inspected: `40291860500`.
- No branch, pull request, merge, dependency, or lockfile change was made by this correction.

## Root cause and correction

| CI test | Cause | Correction |
| --- | --- | --- |
| `master-data-import.test.ts` duplicate normalized key | The parser incorrectly lowercased incoming headers before exact comparison with camelCase official columns such as `fullName`; it rejected its own template. | Compare exact header strings, keep the strict count/order/name check, make the fixture build its header with `worksheet.columns` exactly like the production template, and add a wrong-header rejection test. |
| `security.integration.test.ts` template download | Supertest did not choose a binary parser for the spreadsheet response, so `response.body` was empty although endpoint headers were correct. | Request buffered binary handling through an explicit parser, assert a nonempty `Buffer`, then load it with ExcelJS. The endpoint remains a normal XLSX response. |

The existing tenant isolation, RBAC, cookie/CSRF requirements, atomic one-use preview commit, SIMS conflict policy, and active teacher/employee-only membership rules are unchanged.

## Validation record

| Check | Status | Observed evidence |
| --- | --- | --- |
| `pnpm --filter @novo/api exec vitest run src/master-data-import.test.ts` | PASS | 3/3: normalization, normalized duplicate detection, and wrong-header rejection. |
| `pnpm build` | PASS | Contracts typecheck, API typecheck, and Vite production build complete. |
| `pnpm lint` | PASS | Contracts, API, and Web typecheck lint complete. |
| `pnpm db:generate` | PASS | Prisma Client 6.19.3 generated from the committed schema. |
| `prisma validate` with a non-secret disposable-shaped URL | PASS | Prisma schema validates. |
| Full `pnpm test` | BLOCKED locally | Contracts, API unit tests, and Web tests pass; security integration suite intentionally refuses to start without `NODE_ENV=test` plus a `novo_ci`/`novo_test` PostgreSQL URL. |
| Migration deploy and PostgreSQL integration suite | BLOCKED locally | No Docker executable, local PostgreSQL service, `DATABASE_URL`, or `.env.test` is available. Existing safety guard was preserved. |
| Hosted CI after this correction | not-started | Requires commit/push to the existing Sprint 03 branch. |

## One next task

Commit and push this bounded correction from ordinary Windows PowerShell. Let the existing CI PostgreSQL 16 service run `prisma migrate deploy`, full tests, and lint; inspect only real remaining failures. Do not merge or start Sprint 04.

```powershell
Set-Location C:\Users\raden\dev\projects\NOVO-Business-Centre
git status --short
git diff --check
git add -- apps/api/src/master-data-import.ts apps/api/src/master-data-import.test.ts apps/api/src/security.integration.test.ts docs/IMPLEMENTATION_STATUS.md docs/NOVO-PRD-COVERAGE.md docs/QUEST-TRACEABILITY.md docs/CODEX_HANDOFF.md
git diff --cached --check
git commit -m "test: fix Sprint 03 Excel fixtures"
git push origin codex/sprint-03-master-data-import
```
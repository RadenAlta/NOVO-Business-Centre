# CODEX Handoff — Sprint 03 code-review corrections

## Git state

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch: `codex/sprint-03-master-data-import`; base `main`: `671f049`.
- Reviewed head: `e636a6d`; existing PR: #3.
- This correction set has not been committed or pushed from this environment because Git cannot create `.git/index.lock`.

## Review-correction matrix

| Finding | Code correction | Regression evidence | Current status |
| --- | --- | --- | --- |
| HIGH-03 picker truncation | Added server-side `GET /master-data/member-eligible` restricted to active `TEACHER`/`EMPLOYEE`, tenant-scoped, searchable and paginated. Web picker uses this endpoint with candidate search and paging. | PostgreSQL integration creates 150 students and proves the teacher still appears in the eligible result. | pending hosted CI |
| HIGH-04 incomplete XLSX policy | Archive relationships with `TargetMode=External`, external hyperlinks and formulas anywhere in allowed sheets are rejected. | API unit cases reject hyperlink relationship, formula on Instructions, and accidental template import. | pending hosted CI |
| HIGH-05 non-atomic membership audit | Membership create and active-state transition now use a single Prisma transaction with their audit insertion. | PostgreSQL test installs a temporary audit-failure trigger and proves both create and deactivate roll back. | pending hosted CI |
| MED-01 retention | Kept as mandatory pre-production work: raw XLSX is not stored, while expired parsed preview rows need scheduled retention cleanup. | Threat model and defect register. | OPEN |
| MED-02 demo identities | Examples moved to `Instructions`; the importable sheet contains only headers. | Unit and integration template-upload regression. | pending hosted CI |
| MED-03 SIMS active state | Manual activation/deactivation of `dataSource=SIMS` is rejected consistently with SIMS ownership policy. | PostgreSQL integration negative case. | pending hosted CI |

## FR-003 delete decision

The Sprint 03 delete acceptance is fulfilled by **soft deactivation**, not a destructive delete. This preserves cooperative, finance, shuttle, audit and historical references. The UI and API expose explicit activate/deactivate operations; hard deletion is intentionally outside the Sprint 03 policy.

## Validation record

| Check | Status | Observed result |
| --- | --- | --- |
| API Master Data unit test | PASS | 7/7, including external hyperlink relationship, Instructions formula, and template-without-demo-import regression cases. |
| `pnpm build` | PASS | Contracts, API TypeScript, and Vite production build. |
| `pnpm lint` | PASS | Contracts, API, and Web TypeScript lint. |
| `pnpm db:generate` and `prisma validate` | PASS | Generated Prisma Client and valid committed PostgreSQL schema. |
| Local `pnpm test` | BLOCKED for integration only | Contracts 3/3, Web 13/13, API unit 9/9 pass. `security.integration.test.ts` intentionally rejects non-disposable/no-PostgreSQL execution. |
| Local PostgreSQL integration | BLOCKED | Docker executable and disposable database are unavailable. |
| GitHub Actions | pending | Must run against the eventual correction commit; no success claim is made for unpushed changes. |

## Recommendation

**REQUEST CHANGES** until the correction commit is pushed and PR #3 GitHub Actions completes PostgreSQL migration and security integration tests successfully. Do not merge or start Sprint 04 yet.

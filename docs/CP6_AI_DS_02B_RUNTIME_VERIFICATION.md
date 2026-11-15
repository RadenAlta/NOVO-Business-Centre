# CP6-AI-DS-02B — Runtime Verification Report

Date: 6 November 2026. This report records only observed results for the uncommitted CP6 working tree; it does not promote F4 to verified.

## Git and WIP baseline

- Branch: `codex/sprint-05-planning`.
- HEAD: `a9479c8d6f257e54a74e78affb09b884d5f946ba`.
- Existing Sprint 05 and CP6 tracked/untracked WIP was observed before testing and was not staged, committed, reset, cleaned, checked out, or overwritten.

## Database preflight

| Check | Result | Evidence |
| --- | --- | --- |
| Docker CLI available | PARTIAL | CLI was found. |
| Docker daemon/container identity | BLOCKED | Docker Desktop named-pipe access returned `permission denied`; therefore container identity, port mapping, PostgreSQL version, database name, migrations, and indexes could not be trusted. |
| Database-backed tests | NOT RUN | The gate deliberately prevented any test that creates/cleans fixture data. No fallback host, port, local `novo`, cloud, staging, or production database was used. |

## Observed quality gates

| Layer | Result |
| --- | --- |
| API build | PASS |
| API lint | PASS |
| Web production build | PASS |
| Web unit tests | PASS — 6 files, 22 tests |
| Focused ML tests | PASS — 20 tests; pytest cache permission warning only |
| Python compile | PASS |
| Final-artifact direct inference | PASS — model `activity-category-v0.2-39098d6f4f26` |
| Git whitespace check | PASS — unrelated pre-existing CRLF warnings only |
| Playwright discovery | PASS — 3 existing Shuttle specs found |

## Runtime gates

| Gate | Status | Reason |
| --- | --- | --- |
| `API_SECURITY_VERIFIED` | NOT RUN | Requires the verified disposable PostgreSQL container. |
| `FASTAPI_HTTP_VERIFIED` | BLOCKED | No Docker access for the coupled test environment. Additionally, the current ML model directory lacks the legacy intent/demand artifacts required by the existing FastAPI startup path; starting it would retrain them, which this checkpoint forbids. |
| `EXPRESS_ML_VERIFIED` | NOT RUN | Depends on the two runtime gates above. |
| `BROWSER_E2E_VERIFIED` | NOT RUN | Depends on the runtime gates. Existing Playwright suite contains no F4 activity-classification spec. |
| `READY_FOR_CONTROLLED_DEMO` | NO | Runtime, security, and browser evidence remain incomplete. |

## Security and data-boundary conclusion

Static review and compiled regression scenarios retain the intended boundary: F4 is suggestion-only; Express derives tenant context from the authenticated session; audit metadata excludes the raw note; and the route has no business mutation. These claims still need database-backed runtime confirmation. No invoice, settlement, stock, payment, subscription, or persistent activity was touched by this checkpoint.

## Required owner-run verification

Run the reviewed PowerShell procedure only after Docker Desktop access is available. It must verify `novo-cp5-pg17-test` as PostgreSQL 17 at `127.0.0.1:55433`, user `novo_cp5`, database `novo_test`, nine completed migrations, and the two Shuttle partial unique indexes before setting the in-memory `DATABASE_URL` for tests. Do not run a reset, seed, migration, or any command against `novo`, Supabase, Render, staging, or production.

The next focused checkpoint is CP6-AI-DS-02C: add/run F4-specific authenticated browser E2E only after FastAPI can start from existing non-training artifacts and the Express security suite has passed on the verified disposable database.

# CP6-A2-04K2 Corrective Selective Merge Report

Date: 2026-11-13 (Asia/Jakarta)
Candidate workspace: `C:\Users\raden\Documents\Codex\novo-a2-isolated-reconstruction\novo-merge-s05-s06-20261109-141214`
Candidate branch/HEAD: `codex/merge-s05-s06-20261109-141214` / `a82c471cff4c7921464c7136c1f426329a80d83b`

## Isolation and preservation

- The only edited workspace was the candidate above. Its Git index was empty before and after this checkpoint.
- The original workspace remained `codex/sprint-05-planning` at `a82c471cff4c7921464c7136c1f426329a80d83b`, with an empty index and **74** working-tree paths. No original file, index entry, database, Docker resource, reference workspace, or historical-migration quarantine was changed.
- A pre-edit external backup exists at `C:\Users\raden\Documents\Codex\novo-a2-isolated-reconstruction\04K2-backup-20261109-230000`. It contains the pre-edit candidate copies of `app.ts`, `security.integration.test.ts`, migration 011, the two edited Sprint-05 documents, and the 04J report.
- No commit, push, migration deployment, integration database test, dependency installation, or deployment occurred.

## Migration integrity

The historical A1/A2 migrations were not edited. Their candidate hashes remain:

| Migration | SHA-256 |
| --- | --- |
| `202611020008_shuttle_end_to_end` | `58281D57EFFA648614BF22D6DD3FBD794CF430DBC96C08C39A2FA03C7E7729D4` |
| `202611040009_shuttle_active_subscription_uniqueness` | `F0F9E7879D2FE92E931BD86FA33AA752CE3CFBE30B822EF0C99B5E0C1F285E88` |
| `202611080010_shuttle_financial_lifecycle` | `092DA19CCA16F0B8E63691D55DCA15C026A811F156DBEC77A313918A9A5E89F3` |

Draft migration `202611090011_shuttle_financial_tenant_integrity` now has SHA-256 `3378E1264D4F3EA416DD2E690B6BF88C54A261A923A5701C7EC73349EC2DAAB6`. It remains **unapplied**.

Migration 011 now fails before installation if existing Shuttle financial rows have tenant, period, or allocation-status inconsistencies. Its triggers:

- reject Shuttle invoice/payment/settlement reparenting;
- reject tenant changes on Shuttle subscription and billing-period parents;
- reject a direct status change to an allocated verified Shuttle payment;
- require an allocated payment to be `VERIFIED`, in the same tenant and billing period as its settlement; and
- take `FOR SHARE` locks while reading financial parents in child guards.

This is a draft migration design, not evidence that any existing deployment data passes its preflight.

## Corrective source changes

| Path | Corrective content |
| --- | --- |
| `apps/api/src/app.ts` | Fails closed for the legacy direct Subscription-to-Invoice write; restricts Shuttle payment/void/verify/reverse state-machine routes to tenant-scoped, period-backed Shuttle records; validates idempotent reference replay before overpayment; blocks new payment/verification after settlement; returns a minimal selected finance invoice shape rather than raw nested Prisma relations; requires finalized periods for Cashier collectible selection; uses the Jakarta period label for invoice descriptions; and centralizes post-Multer file cleanup in a `finally` block. |
| `apps/api/src/security.integration.test.ts` | Converts payment-route fixtures to finalized, period-backed Shuttle invoices; adds negative generic-domain and foreign-tenant checks; verifies replay/mismatch/reversed-reference/settled-period behavior; tests invalid attachment metadata leaves neither record, audit, nor file; and adds direct-database regression coverage planned for migration 011 guards. Test declarations changed from **61** to **64**. |
| `apps/api/src/shuttle-billing.ts`, `apps/api/src/shuttle-billing.test.ts` | Adds a fixed-offset Jakarta `YYYY-MM` period-label helper and boundary regression coverage. This prevents a stored Jakarta local-midnight period from being labelled with its preceding UTC month. |
| `apps/api/prisma/migrations/202611090011_shuttle_financial_tenant_integrity/migration.sql` | Tightens draft preflight, parent immutability, allocation eligibility, and locking without changing migrations 008–010. |
| `docs/API-CONTRACT.md` | Documents the retired legacy route, finance response minimization, domain boundary for Shuttle state-machine writes, finalized-period Cashier selection, and payment replay behavior. |
| `docs/SPRINT05_BUSINESS_DECISIONS.md` | Labels the older “no lifecycle model” wording as historical context and retains D05-01 through D05-07 as PROVISIONAL. |
| `docs/CP6_A2_04K2_CORRECTIVE_MERGE_REPORT.md` | This checkpoint record. |

## P1 resolution status

| Finding | Source status | Runtime evidence |
| --- | --- | --- |
| P1-A: generic/domain and tenant financial-route mutation | Implemented: four Shuttle state-machine writes use tenant and Shuttle-period guards; generic records return `404` without mutation. | **NEEDS DISPOSABLE DB QA** |
| P1-B: idempotent payment ordering and settlement freeze | Implemented: invoice domain lookup then eligible same-tenant reference replay; mismatch/null/reversed references are `409`; new payment/verification reject settled periods. | **NEEDS DISPOSABLE DB QA** |
| P1-C: orphan upload cleanup | Implemented: all post-Multer validation, parent, signature, rename, DB, and audit paths share one safe `finally`. | **NEEDS DISPOSABLE DB QA** |
| P1-D: migration 011 financial integrity | Improved draft: preflight, immutable parents, verified allocation, settlement-state checks, and parent locks. | **BLOCKED ON APPROVED MIGRATION QA** |

## Test and QA status

`git diff --check` completed with exit code **0**. Git emitted pre-existing LF/CRLF warnings only.

The candidate has no usable dependency installation (`node_modules` executables were absent). Attempts to invoke Prisma validation, generation, focused API tests, workspace build, and workspace lint through the globally available pnpm 11.25.0 were blocked before the tools launched: pnpm attempted workspace dependency setup and failed with a sandbox `EPERM` while creating its project-store symlink. No dependency installation was authorized or performed. Therefore all of these checks are **NOT RUN**, not passing:

- Prisma validate/generate;
- workspace build/lint;
- focused unit tests;
- all PostgreSQL integration tests.

The first failed invocations used an invalid `--offline` placement and exited before package scripts; corrected invocations confirmed the same dependency-store `EPERM` blocker. Neither result is application-test evidence.

A focused credential-pattern scan was also reviewed. Its only matches were pre-existing password schema names and synthetic test passwords; no connection string, access token, API key, or production credential was present in the changed implementation, migration, or documentation paths.

## Policy and residual risk

D05-01 through D05-07 remain **PROVISIONAL**. This checkpoint does not approve subscription eligibility, Jakarta cut-off treatment, proration operations, vendor shares, corrections/refunds, production finance RBAC, generic-model lifecycle ownership, or proof retention.

Remaining material risks:

1. Migration 011's preflight could reject historical data; it has not run against any database.
2. PostgreSQL/Prisma error wrapping for the exact `23514` tests must be confirmed in the approved disposable environment.
3. The `FOR SHARE` trigger locking and concurrent settlement/reversal behavior require real PostgreSQL execution.
4. The generic finance-list response change requires existing Shuttle UI and finance-consumer regression validation.
5. Full A1/A2/A3/F4 integration and browser tests have not been rerun from this candidate.

## Required approval checkpoint: CP6-A2-04L

Before any migration or integration test, obtain approval for a new disposable PostgreSQL 17 instance that is not A1/A2 and does not use ports 55433/55434. Preflight must verify a fresh named `novo_test` database, isolated volume/container, `NODE_ENV=test`, candidate branch/HEAD, no `.env` fallback, migrations 001–011 only, and a recorded backup/cleanup plan. Then run Prisma validation/generation, focused unit tests, the 64-test security suite, migration preflight/constraint tests, and full regression. Do not use development, Supabase, Render, staging, or production data.

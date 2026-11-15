# CP6-A2-04K4 Financial Integrity Hardening

Date: 2026-11-13 (Asia/Jakarta)

## Scope and preservation

- Edited workspace only: `C:\Users\raden\Documents\Codex\novo-a2-isolated-reconstruction\novo-merge-s05-s06-20261109-141214` on `codex/merge-s05-s06-20261109-141214` at `a82c471cff4c7921464c7136c1f426329a80d83b`.
- Candidate index remained empty. No commit, staging, push, migration deployment, database operation, Docker operation, dependency installation, or deployment occurred.
- Original workspace was rechecked as `codex/sprint-05-planning` at the same HEAD, with empty index and **74** WIP paths. It was not edited.
- Pre-edit copies of the candidate migration, `app.ts`, and `security.integration.test.ts` were created outside the candidate at `C:\Users\raden\Documents\Codex\novo-a2-isolated-reconstruction\04K4-backup-20261113-001500` and hash-compared during creation.

## Historical migration verification

| Migration | SHA-256 | Result |
| --- | --- | --- |
| 008 `shuttle_end_to_end` | `58281D57EFFA648614BF22D6DD3FBD794CF430DBC96C08C39A2FA03C7E7729D4` | unchanged |
| 009 `shuttle_active_subscription_uniqueness` | `F0F9E7879D2FE92E931BD86FA33AA752CE3CFBE30B822EF0C99B5E0C1F285E88` | unchanged |
| 010 `shuttle_financial_lifecycle` | `092DA19CCA16F0B8E63691D55DCA15C026A811F156DBEC77A313918A9A5E89F3` | unchanged |
| 011 `shuttle_financial_tenant_integrity` | `482D883F9718354236A5D07D14FAEC9EAB965BF3B907B24BD75A45724044C08F` | revised draft; unapplied |

## Changes

| Path | Change |
| --- | --- |
| `apps/api/prisma/migrations/202611090011_shuttle_financial_tenant_integrity/migration.sql` | Adds historical-data preflight for Shuttle/generic Payment status mismatch; blocks generic Payment status, NULL Shuttle Payment status, mutation of allocated verified Payment financial/identity/verification fields, mutation of settled Invoice financial snapshots, mutation of settlement financial snapshots, and finalized billing-period calendar/timezone/status changes. Existing tenant/reparenting and verified-allocation controls remain. |
| `apps/api/src/app.ts` | Counts only `RECORDED` and `VERIFIED` payments as committed for Shuttle collection; uses a strict Payment-reference P2002 classifier before replay fallback. |
| `apps/api/src/shuttle-payment-reference-unique.ts` | New exact P2002 classifier accepting only the tenant/reference unique constraint or exact PostgreSQL identifier. |
| `apps/api/src/shuttle-payment-reference-unique.test.ts` | Unit regression for accepted exact metadata and rejected unrelated, duplicated, prefixed, and suffixed targets. |
| `apps/api/src/security.integration.test.ts` | Extends the existing direct-PostgreSQL migration-011 regression with generic/Shuttle status mismatches, finalized period mutation, allocated Payment amount/status mutation, settled Invoice snapshot mutation, and settlement snapshot mutation. The suite remains **64** `it(...)` declarations. |
| `docs/CP6_A2_04K4_INTEGRITY_HARDENING_REPORT.md` | This report. |

## Invariant checklist

| Invariant | Source status | Runtime status |
| --- | --- | --- |
| Generic Invoice ⇒ Payment status is NULL | Migration 011 preflight and trigger | NOT RUN |
| Period-backed Shuttle Invoice ⇒ Payment status is non-NULL | Migration 011 preflight and trigger | NOT RUN |
| Allocated verified Payment amount/reference/method/timestamps/status immutable | Migration 011 trigger | NOT RUN |
| Settled Invoice amount and route/rate/proration snapshot immutable | Migration 011 trigger | NOT RUN |
| Settlement financial share snapshot immutable | Migration 011 trigger | NOT RUN |
| Finalized period bounds/timezone/status immutable | Migration 011 trigger | NOT RUN |
| Payment replay only handles tenant/reference P2002 | Exact source helper and unit regression | NOT RUN |
| Collection committed amount ignores malformed NULL status rows | Explicit `RECORDED`/`VERIFIED` filter | NOT RUN |

## Allocation deletion policy

No `DELETE` trigger was added for `ShuttleSettlementPayment`. The shared integration cleanup deletes allocations before settlements; a global database delete ban would break that teardown and would silently invent an operational settlement-correction policy not approved under D05. The direct SQL regression documents that this remains possible for isolated fixture cleanup. This is a deliberate **PROVISIONAL/P2 gap**: production deallocation/correction must receive an approved, audited workflow and role/connection design before deployment.

## Validation performed

- `git diff --check`: **PASS** (exit 0; pre-existing CRLF warnings only).
- Static migration/source inspection and read-only hash verification: **PASS**.
- Prisma validate/generate, TypeScript build, lint, unit tests, PostgreSQL migration, integration tests, and browser tests: **NOT RUN**. This checkpoint expressly forbids dependency installation and database execution. Prior candidate dependency attempts were blocked by pnpm project-store symlink `EPERM`; that is environmental, not test evidence.

## Residual blockers for CP6-A2-04L

1. Run migrations 001–011 only in an approved, newly created PostgreSQL 17 disposable environment—not old A1/A2 databases or ports 55433/55434—and prove the migration preflight passes.
2. Confirm Prisma's actual rendering of trigger `23514` errors for every new direct-SQL assertion.
3. Run all 64 security integration declarations plus the new P2002 unit tests, A1 tests, full build/lint, and browser/API contract regressions.
4. Review the intentional allocation-delete gap with the D05 correction/refund policy owner. D05-01 through D05-07 remain PROVISIONAL; FR-007 remains PARTIAL; MED-01 remains OPEN.

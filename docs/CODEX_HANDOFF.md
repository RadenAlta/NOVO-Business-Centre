# Sprint 05 — Shuttle foundation worktree handoff

## Shuttle UI checkpoint (uncommitted)

- `apps/web/src/shuttle-page.tsx` replaces the minimal Shuttle screen with role-gated views for Route/Subscription search and creation, billing periods, invoice/payment history, payment record/verify/reverse, private proof upload/download in the active session, settlement lifecycle, and report metrics. The interface uses confirmed API endpoints only; it deliberately does not present route edit, subscription lifecycle changes, Guardian linkage, standalone invoice detail, or historical proof listing because the API does not provide those operations.
- The owner reported isolated Windows `novo_test` evidence on 3 Nov 2026: eight migrations current, 99/99 API tests and 48 security/integration tests PASS. Those results cover backend work at that checkpoint; they are not a browser E2E result for this UI.
- This session observed API non-database unit tests 51/51 PASS, API build/lint PASS, Web build/lint PASS, and Web tests 19/19 PASS. No PostgreSQL call, seed, reset, staging, or production access occurred. FR-007 remains partial; MED-01 remains OPEN.
- Browser-integration correction: the Shuttle UI previously treated `SUPER_ADMIN` as outside the invoice-read list even though server `requireRoles` delegates that role to all defined roles. `hasRole` now mirrors the server delegation map, and an isolated API regression for same-tenant `SUPER_ADMIN` invoice reads was added. It type-checks but remains **NOT RUN** against PostgreSQL in this environment. The simultaneous 500-style failures on Subscription/Billing/FinancialConfig/Settlement/Report are not caused by empty data or missing configuration: their handlers return empty/null contracts. The common dependency is migration `202611020008_shuttle_end_to_end`; confirm the development `novo` schema/version and server log in the local Windows environment before claiming that environment blocker resolved.
- Shuttle correction checkpoint (uncommitted): `POST /shuttle/subscriptions/:id/cancel` and `POST /billing/invoices/:id/void` are tenant-scoped, CSRF/RBAC-protected serializable corrections with mandatory reason and atomic AuditLog. Cancellation preserves historical invoices but blocks future ad-hoc invoices; invoice void is rejected when any Payment exists and explicitly distinguishes a settlement allocation. Repeated correction requests are no-op `200` responses and do not duplicate audit events. Shuttle reporting excludes `VOID` invoices and related payments. New database integration scenarios are written but **NOT RUN** here; no development `novo` data was changed.
- Data-integrity follow-up: do not add a partial unique active-subscription index until the three known historical duplicates are remediated and a preflight confirms every active row has exactly one rider key. Proposed future constraint: a tenant/route/rider partial unique index for `status = 'ACTIVE'`, using the agreed canonical rider identity. It must ship as a reviewed migration after backup and isolated migration-harness evidence, not as an ad-hoc development change.
- Active-subscription hardening checkpoint (uncommitted): owner reports the historical correction is complete. Migration `202611040009_shuttle_active_subscription_uniqueness` now defines separate active-member and active-student PostgreSQL partial unique indexes. The server keeps the existing XOR input validation and serializable retry, and maps only P2002 errors naming these indexes to `DUPLICATE_ACTIVE_SUBSCRIPTION`; other unique violations still use `DUPLICATE_RECORD`. New API/direct-database regressions are written but **NOT RUN** after adding this migration because this session cannot access a disposable PostgreSQL server. Do not apply the migration to `novo` until a read-only identity preflight and a fresh backup are approved.

- Current branch/baseline: `codex/sprint-05-planning` from merged Sprint 04 baseline `a9479c8d6f257e54a74e78affb09b884d5f946ba`. This Sprint 05 checkpoint is deliberately **uncommitted**: user approval is required before any commit, push, PR, merge, or deployment.
- Changed source: the existing Shuttle Route, Subscription, Invoice, and Payment writes now use one serializable transaction with their AuditLog write. Route and subscription reads accept tenant-scoped search/filter/pagination; subscription creation rejects an end date before its start date and unavailable cross-tenant/inactive dependencies. Payment recording has a domain-specific serialization-conflict response and keeps its existing overpayment guard.
- New integration scenarios cover CSRF/RBAC and tenant-scoped Route reads, subscription dates/foreign routes, Route/Subscription/Invoice/Payment audit rollback, and concurrent payment overpayment. They are in the established `security.integration.test.ts` harness, which refuses any database except `novo_ci` or `novo_test` with `NODE_ENV=test`.
- Observed local checks for this worktree: Prisma validate/generate PASS; workspace build/lint PASS; API non-database tests PASS (48/48, including the focused serializable-transaction suite 7/7); Contracts tests PASS (3/3); Web tests PASS (13/13); `git diff --check` PASS. Docker/PostgreSQL access was denied in this environment, so the Shuttle PostgreSQL suite is **BLOCKED LOCALLY**, not passed. No database was modified.
- `SPRINT05_BUSINESS_DECISIONS.md` records seven proposed decisions that must be confirmed before billing-period, proration, vendor/share, correction/refund, finance-RBAC, generic-model migration, or payment-proof behavior is added. The proposals have no active transaction effect.
- FR-007 remains **partial**. MED-01 scheduled structured import-preview retention purge remains **OPEN** before real-personal-data production use. All 86 requirement IDs, including 42 Side Quests, remain tracked without promotion.

# Sprint 04 — final acceptance handoff

- Branch/source checkpoint: `codex/sprint-04-store-pos-inventory` at `41c509b39e9b32297b4314586d8e0023923864fe`.
- HIGH-01 and HIGH-02A/B are CLOSED with recorded hosted CI evidence. Store inventory idempotency is implemented in migration `202610290007_store_inventory_idempotency`.
- Final validation evidence on 2026-11-02: Prisma validate/generate, API/Web builds, API/Web/Contracts type checks, Store/API non-database tests (47/47), Contracts tests (3/3), Web tests (13/13), security integration (35/35), and the legacy SKU migration harness passed. PostgreSQL work ran only through isolated `novo_test`.
- Owner-provided staging evidence records `41c509b` deployed, seven applied migrations, health 200, Prisma-backed invalid-session validation, backup/restore verification, and no residual synthetic tenant/movement data. This session did not alter staging.
- PR #4 is OPEN, non-draft, MERGEABLE/CLEAN at `41c509b`, with five listed checks SUCCESS. `reviewDecision` is empty; see `SPRINT04_FINAL_ACCEPTANCE.md` for the review checklist. Do not merge automatically.
- FR-006 remains **partial** across the 86-requirement roadmap; MED-01 is staging-verified but remains production-operations OPEN before real personal-data processing.
# CODEX Handoff — Sprint 03 PR #3 final XLSX hardening

## Git state

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch: `codex/sprint-03-master-data-import`; base `main`: `671f049`; existing PR: #3.
- Latest pushed baseline: `28fa14a`, with PR #3 GitHub Actions reported **4/4 PASS** by the review request.
- Current tree changes HIGH-06 and HIGH-07 only. They are not committed or pushed from this environment because Git cannot create `.git/index.lock`.

## Sprint 03 review and hardening state

| Finding | State | Evidence / boundary |
| --- | --- | --- |
| HIGH-03 eligible membership picker | CLOSED at `28fa14a` | Server filters active same-tenant teachers/employees before search/paging; PostgreSQL regression covers 150 students. |
| HIGH-04 XLSX formulas/external content | CLOSED at `28fa14a` | Hosted baseline tests reject external worksheet links and formulas outside the import region. |
| HIGH-05 membership/audit atomicity | CLOSED at `28fa14a` | Hosted trigger-failure regression proves creation/status and audit roll back together. |
| HIGH-06 ZIP inflation | code fixed; hosted CI pending | Decompression output is bounded; actual entry size must equal central-directory size; actual aggregate output is capped before ExcelJS. |
| HIGH-07 relationship XML bypass | code fixed; hosted CI pending | Bounded SAX parser checks every `.rels`, including `_rels/.rels`; it decodes attributes, rejects external mode/DTD/malformed or oversized XML, and limits relationship count. |
| MED-01 preview retention purge | **OPEN** | Required before production processing of personal data; raw XLSX bytes are not persisted. |
| MED-02 template examples | CLOSED at `28fa14a` | Examples are in `Instructions`, never in importable data rows. |
| MED-03 SIMS activation ownership | CLOSED at `28fa14a` | Manual activation changes for SIMS-owned identities are denied. |
| FR-003 delete | documented | Soft deactivation is the non-destructive Sprint 03 delete operation, preserving history. |

## Validation record for current working set

| Check | Status | Observed result |
| --- | --- | --- |
| Contracts/API/Web TypeScript checks | PASS | Direct TypeScript checks for contracts, API and Web completed without errors. |
| Production Web build | PASS | Vite completed production build (1,735 modules transformed). |
| API unit/security parser tests | PASS | `lib.test.ts` + `master-data-import.test.ts`: 14/14 tests passed. Parser coverage includes metadata falsification, bounded relationship XML, encoded root external mode, DTD rejection, safe internal relation, external hyperlink and formula. |
| Contracts/Web tests | PASS | 16/16 tests passed across contracts and Web. |
| Prisma schema validation | PASS | `prisma validate --schema apps/api/prisma/schema.prisma` passed with a local disposable URL supplied only for schema validation. |
| `pnpm build`, `pnpm lint`, full workspace `pnpm test` | BLOCKED locally | pnpm attempts to register the workspace using a project-store symlink; this managed environment rejects it with `EPERM`. Direct equivalent non-database checks above passed. |
| Local PostgreSQL integration | BLOCKED locally | Docker and a disposable PostgreSQL runtime are unavailable. |
| New hosted GitHub Actions | pending | The reported 4/4 pass belongs to `28fa14a`, before HIGH-06/HIGH-07. |

## Traceability and next action

All 86 IDs remain tracked: 14 FR, 10 NFR, 20 Main Quest and 42 Side Quest. No status is promoted to `verified` from these local checks. The next safe action is to commit/push this exact hardening set and wait for all four PR #3 checks, including migration and PostgreSQL integration.

**Recommendation: REQUEST CHANGES** until that CI run succeeds. Do not merge or start Sprint 04.

## CP6-AI-DS-01 handoff — activity dataset and model foundation

- New ML-only paths: `services/ml/app/activity_dataset.py`, `services/ml/app/activity_training.py`, `services/ml/scripts/train_activity_models.py`, and focused dataset/training tests. Existing intent, demand, and RAG modules remain separate.
- The dataset generator is deterministic (`seed=20261105`), synthetic-only, de-identified, class-balanced by construction, and has fixed template-family grouping across train/validation/test. The validation guard rejects invalid fields, personal-contact-like text, duplicate IDs/notes, cross-split template reuse, and high-overlap near duplicates.
- Training compares TF-IDF + Logistic Regression with TF-IDF + LinearSVC using validation macro-F1; it reports macro-F1, per-class precision/recall/F1, confusion matrices, error analysis, seed, dataset hash, label version, and caveats. Artifacts are generated only into an explicit local model directory.
- FastAPI now has a source-level `POST /v1/activity-category/predict` contract. It accepts a de-identified note and returns a suggestion plus version metadata; a LinearSVC decision score is not represented as a probability.
- Observed local validation for CP6: `git diff --check` PASS. Python compile/test/training are **BLOCKED LOCALLY** because the only resolved executable is an inaccessible Windows Store launcher. No database, migration, or cloud service was touched. Requirement statuses remain partial and MED-01 remains OPEN.

### CP6-AI-DS-01B runtime correction

- Owner-provided `services/ml/.venv` was available in the workspace and Python 3.12.13 was used. `compileall` passed; activity dataset tests passed 8/8 and activity training tests passed 3/3.
- Training with seed `20261105` wrote local, uncommitted artifacts below `services/ml/models/`: `activity_category.joblib` and `activity_category_evaluation.json`. Logistic Regression was selected with validation macro-F1 `0.281250` and held-out macro-F1 `0.250000`, with 15 held-out errors. Treat this as an explicit quality failure for F4 integration, not a model success claim.
- A combined legacy ML pytest command did not conclude within this session's terminal wall limit while an existing RAG test was still running. No full-suite PASS is claimed; re-run it in normal Windows PowerShell before a review/commit.
## CP6-AI-DS-02 handoff — protected F4 suggestion integration (uncommitted)

- CP6-specific additions are the F4 final-artifact loader, stable FastAPI schema, protected Express proxy, API regression scenarios, React suggestion/draft component, its web view-model tests, API contract update, and `CP6_AI_DS_02_INTEGRATION_EVIDENCE.md`.
- Do not claim runtime acceptance yet. The observed checks are API build/lint, Web build, 22 Web tests, focused 20 ML tests, direct final-artifact smoke, and `git diff --check`; PostgreSQL integration and browser E2E are not run because this session could not identify an approved disposable database.
- Before review/commit, use only an explicit `novo_test`/`novo_ci` target for `pnpm --filter @novo/api test`, run FastAPI with `NOVO_ACTIVITY_MODEL_DIR=./models/activity_category_v02_final`, then execute authenticated browser coverage. Do not use `novo`, staging, Supabase, Render, or a fallback artifact.
- F4 remains suggestion-only, `PARTIAL`, and synthetic-data-limited. MED-01 remains OPEN.

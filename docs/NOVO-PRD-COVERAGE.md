# Sprint 05 — Shuttle foundation coverage note

FR-007 remains **partial**. The uncommitted Sprint 05 worktree now includes the Shuttle API and UI flow for routes, subscriptions, billing periods, generated/finalized invoices, payment record/verification/reversal, tenant-scoped Payment proofs, settlement draft/approval/paid actions, and Shuttle reporting. The UI is role-gated and renders loading, empty, error, confirmation, and success states; it uses only server-provided totals and excludes private attachment storage metadata. It now also has source-level safe cancellation/void correction endpoints: a subscription cancellation preserves history and blocks future invoice issuance; an unpaid/unsettled invoice may be voided, while payment/settlement-linked invoices are rejected. Reporting excludes VOID invoices. The new PostgreSQL regression scenarios have not yet run. Owner-provided Windows evidence on 3 Nov 2026 records isolated `novo_test` with 99/99 API tests and 48 security/integration scenarios PASS for the earlier checkpoint. The new frontend session observed build/lint and 19/19 Web tests PASS, but no browser E2E was run here. Missing lifecycle/detail/list endpoints, policy confirmation, independent acceptance audit, a reviewed database-level active-subscription uniqueness constraint after historical-data remediation, and all unrelated roadmap work keep FR-007 partial. No FR, NFR, Main Quest, or Side Quest is promoted by this checkpoint. MED-01 remains OPEN.

CP5-API-03 adds one end-to-end PostgreSQL acceptance scenario in source: synthetic route → eligible rider → ACTIVE subscription → November billing period → generated/finalized Rp100.000 invoice → two Cashier-recorded partial payments → Finance verification → DRAFT/APPROVED/PAID settlement → reconciled report and audit assertions. It also asserts reversal rejection after settlement allocation. The scenario remains **NOT RUN in this session** because the disposable Docker target could not be re-identified from this process; it must not be used as a verified acceptance claim yet.

## CP6-AI-DS-01 — F4 activity classification boundary

The Capstone demonstrator needs a model that categorises de-identified operational notes, not merely the existing customer-question intent router. CP6 adds a synthetic-only working contract with candidate categories inventory, sales, service, and administration; grouped train/validation/test controls; two original TF-IDF model candidates; and a FastAPI response that exposes an uncalibrated LinearSVC score separately from a probabilistic confidence. The model has no authority to mutate NOVO transactions. These source changes are `partial` evidence only until Python unit training, FastAPI serving, Express proxy, browser correction flow, and PIC taxonomy review have been observed. The generic provider assistant is not promoted as F5 because it has not yet been constrained to server-computed, tenant-authorized aggregates.

CP6-AI-DS-01B observed Python unit/training evidence but found low held-out F4 quality: the seed-`20261105` synthetic run selected Logistic Regression with macro-F1 `0.250000` on the test split. This blocks model integration rather than closing the gap; no requirement status changes.

The reviewed partial-index migration now exists but has not been deployed by this session. It is intentionally limited to `ACTIVE` rows and non-null rider keys, allowing corrected CANCELLED history and a future replacement subscription. Its database audit and migration evidence must come from `novo_test`, never from the development `novo` database.

# Sprint 04 CP4-D2 — Store SKU integrity update

FR-006 remains **partial** in the 86-requirement project audit. HIGH-02A/B are CLOSED with recorded PostgreSQL CI evidence; Sprint 04 also includes inventory idempotency migration `202610290007_store_inventory_idempotency`. Owner-provided evidence records isolated `novo_test`, seven migrations, 35/35 security integration PASS, SKU harness PASS, deployed `41c509b`, staging health/auth-path validation, backup/restore verification, and PR #4 MERGEABLE/CLEAN with five checks SUCCESS. `reviewDecision` is empty; MED-01 remains production-operations OPEN.
# NOVO PRD Coverage — Sprint 03 code-review corrections

Scope: PR #3 corrections through baseline `28fa14a`, plus uncommitted HIGH-06/HIGH-07 hardening. The authoritative 86-row status remains [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); no requirement is promoted to `verified` by source review alone.

## Revised acceptance matrix

| Requirement | Acceptance criterion | Correction/evidence | Status |
| --- | --- | --- | --- |
| FR-003 Master Data | Student/teacher/employee CRUD, normalized uniqueness, tenant/RBAC boundary, search/paging, and non-destructive delete policy | New eligible-member API prevents a student-heavy directory from hiding teachers. SIMS activation is server-owned. Delete is documented soft deactivation to preserve history. | partial; baseline CI passed at `28fa14a`; hardening CI pending |
| FR-004 Secure Excel Import | No accidental demo import; exact template; reject unsafe archive/cell content; user/tenant/expiry preview; atomic one-use commit | Examples only live in Instructions. Actual ZIP expansion is bounded before ExcelJS, all relationship files including package root are SAX-parsed, decoded `TargetMode=External` is rejected, and all-sheet cell policy rejects formulas/external links. Local parser cases cover the policy; hosted CI for this hardening is pending. | partial; CI pending |
| FR-005 Membership | Active same-tenant teacher/employee only, duplicate/student/inactive/foreign denial, lifecycle, audit and history | Create/status/audit are a single transaction. Trigger-based PostgreSQL tests prove rollback on audit failure. | partial; baseline CI passed at `28fa14a`; hardening CI pending |

## Retained product boundary

Store/POS, Shuttle, Catering, Funding, Financing, Master Data, Membership, Reporting, SIMS and Backup remain tracked. Purchasing remains an extension. All 14 FR, 10 NFR, 20 Main Quest and 42 Side Quest rows remain in the roadmap.

## Verification limit

The baseline correction code has owner-reported 4/4 hosted CI evidence at `28fa14a`. HIGH-06/HIGH-07 have local API type-check and parser-test evidence only; PostgreSQL integration, migration deployment, full build/lint and CI remain pending the hardening commit. Browser E2E, deployment, performance, backup/restore and real-data retention compliance remain outside this audit.
## CP6-AI-DS-02 — F4 protected suggestion path (uncommitted)

The current working tree adds a protected, tenant-contextual F4 suggestion path and browser draft correction without activity persistence. It does not alter any NOVO financial, inventory, membership, or Shuttle behaviour. It is **partial**, not verified: API/Web/ML static checks and artifact inference pass, while disposable-PostgreSQL security execution, FastAPI HTTP runtime smoke, and browser E2E are still required. The model remains synthetic-only and not production-ready. Details and release gates are recorded in `CP6_AI_DS_02_INTEGRATION_EVIDENCE.md`.

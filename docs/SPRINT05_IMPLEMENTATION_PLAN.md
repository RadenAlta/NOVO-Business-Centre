# Sprint 05 Implementation Plan - SO Shuttle End to End

**Planning date:** 2 November 2026  
**Planning branch:** `codex/sprint-05-planning`  
**Planning baseline:** `a9479c8d6f257e54a74e78affb09b884d5f946ba` - Sprint 04 squash merge  
**Status:** Planning plus decision-independent foundation checkpoint. Sprint 05, FR-007, and every Quest remain incomplete unless separately supported by implementation and observed test evidence.

**UI checkpoint, uncommitted:** the available Shuttle endpoints are now consumed by a role-gated web workflow for routes, subscriptions, billing periods, invoices/payments, Payment proof upload/download, settlement, and reporting. There is no browser E2E evidence in this repository session. The missing API capabilities listed in the acceptance/risk sections below remain scope gaps; FR-007 is still `partial`.

## Foundation checkpoint 2 November 2026

The current uncommitted worktree implements only safe foundations from this plan: paged/filterable tenant-scoped Route and Subscription reads; subscription date/dependency validation; atomic business-write plus AuditLog transactions for existing Route, Subscription, Invoice, and Payment writes; and serializable retry around existing payment recording. It also adds disposable-PostgreSQL scenarios for RBAC/CSRF, tenant isolation, audit rollback, and concurrent overpayment. Prisma validate/generate, workspace build/lint, API non-database tests (48/48), Contracts (3/3), and Web (13/13) passed locally. PostgreSQL execution is blocked locally because this environment cannot access Docker; no database test or financial feature is claimed passed until it runs against an approved `novo_test` or `novo_ci` database. No migration, billing formula, proration, vendor-share, settlement, refund, or subscriber-policy rule is activated by this checkpoint.

## Planning sources

- Product sequence and the formal Stage 05 target: `docs/codex/NOVO_CODEX_MASTER_BACKLOG_v2.md`.
- Product scope: the original NOVO PRD section 11 and the integrated NOVO x Asah v4 section 4.2, retained locally under `_local_refs/`.
- Requirement status and evidence limits: `docs/IMPLEMENTATION_STATUS.md`, `docs/NOVO-PRD-COVERAGE.md`, `docs/QUEST-TRACEABILITY.md`, `docs/CODEX_HANDOFF.md`, and `docs/SPRINT04_FINAL_ACCEPTANCE.md`.
- Current implementation and contract: `apps/api/prisma/schema.prisma`, `apps/api/src/app.ts`, `apps/web/src/pages.tsx`, and `docs/API-CONTRACT.md`.
- Main/Side Quest and learning-path/PIC guidance: `docs/codex/NOVO_CODEX_REQUIREMENTS_86.json` and the local official Tech Stack workbook. The planning document does not replace those sources.

## 1. Sprint goal

Implement the NOVO **SO Shuttle end-to-end** workflow required by **FR-007**:

```text
Subscription -> Billing Period -> Generate Billing -> Finalize -> Payment -> Settlement -> Reporting
```

The official master backlog explicitly assigns Stage 05 to Shuttle and names subscriptions, billing, partial payments, vendor share, settlement, attachments, and reporting as its target. The original NOVO PRD classifies FR-007 as a Must requirement. This sprint therefore strengthens the business domain already present in the codebase; it is not a reason to substitute AI, Data Science, Catering, Funding, Financing, or Purchasing work for Shuttle delivery.

## 2. Evidence-based baseline

### 2.1 What exists

The current schema has tenant-scoped `ShuttleRoute`, `ShuttleSubscription`, `Invoice`, `Payment`, `Settlement`, and `SettlementPayment` models. The API has basic route and subscription list/create endpoints, one endpoint that creates an invoice for a subscription, invoice listing, and a payment endpoint with an overpayment check. The web Shuttle screen currently lists routes and creates routes/subscriptions.

These are useful foundations, but they do **not** demonstrate an end-to-end billing-period, finalization, settlement, attachment, reporting, or PostgreSQL integration-test workflow. The implementation-status record correctly leaves FR-007 as `partial` and specifically records no billing/settlement integration test.

### 2.2 Sprint 04 carry-over boundary

Sprint 04 merged at the stated baseline and its acceptance evidence remains relevant as a regression baseline only. FR-006 is still `partial` in the 86-requirement register, authenticated staging Store journeys remain unexecuted, and MED-01 (structured import-preview retention purge in production operations) remains open. None of those items enters Sprint 05 automatically. They must remain visible in release/operational planning and must not be silently changed by Shuttle work.

### 2.3 Documentation hygiene observation

The four long-lived traceability documents continue to track all 86 entries, but several contain historical Sprint 03 headers/evidence alongside Sprint 04 appendices. The Sprint 05 implementation PR must update the affected rows and evidence dates coherently; it must not promote a requirement merely because a route or model exists.

## 3. Scope

### In scope

1. Tenant-scoped Shuttle route configuration and subscription lifecycle.
2. A persisted billing-period boundary, safe batch generation, and explicit finalization semantics.
3. Tenant-scoped invoices with partial and multiple payment recording, balance/status derivation, and duplicate/overpayment protection.
4. Vendor/cooperative-share and settlement records with an auditable relation to the payments they settle.
5. Authorized payment-proof attachments using the existing attachment security boundary, after validating the parent Shuttle entity.
6. Shuttle operational reporting for billing, payment, unpaid balance, vendor/cooperative share, and settlement. Metrics must remain domain-specific; they are not cross-unit revenue.
7. Shuttle web workflows with loading, empty, success, error, and access-denied states.
8. Prisma, API, web, and PostgreSQL integration tests, plus updated API contract, threat model/acceptance evidence, and 86-row traceability.

### Explicitly out of scope

- Catering, Funding, Financing, Purchasing, SIMS synchronization, cross-unit Reporting Core, backup/restore, and production deployment.
- A new ML model, model retraining, a generative summary, RAG, or a Data Science dashboard. Existing Shuttle active-subscription count may remain an input to the existing development-only demand proxy, but Sprint 05 must not make an ML accuracy or business-impact claim.
- A redesign of the entire generic attachment subsystem or a migration to external object storage.
- Any use of real school, rider, payment, or vendor data.
- Closing Sprint 04's remaining operational evidence gaps.

## 4. Traceability and team responsibilities

### 4.1 Primary product requirements

| Requirement | Sprint 05 treatment | Evidence needed before a verified claim |
| --- | --- | --- |
| FR-007 | Primary deliverable: subscription, billing, payment, settlement, reporting. | Executable PostgreSQL/API and web evidence for the complete workflow. |
| FR-008 | Supporting boundary for payment proof attachments only. | Authorized same-tenant upload/download and negative authorization tests. |
| FR-001, FR-002 | Reused platform controls. | Session, current role, and tenant checks exercised on Shuttle endpoints. |
| NFR-001 | Persistence must be exercised using migration deploy and disposable PostgreSQL. | Migration + restart/deploy evidence remains a broader operational item. |
| NFR-003, NFR-004 | Server authority and atomic audit history for financial mutations. | CSRF/RBAC/tenant tests and rollback injection tests. |
| NFR-005, NFR-007, NFR-010 | Clear UI state, maintainable contracts, responsive access. | Web tests plus documented manual/responsive observation where authorized. |

### 4.2 Main Quest and Side Quest mapping

Sprint 05 is a product-domain sprint, not a replacement capstone track. The relevant Full-Stack Main Quest quality conditions are FU-01 through FU-05: a defined cooperative operations problem, usable features, correct result feedback, clear loading/error feedback, and guidance. FU-06 requires separate public/mobile deployment evidence and is not completed by local Shuttle work.

The directly relevant optional Side Quest evidence is SQ-01 to SQ-04, SQ-06, SQ-10, SQ-11, SQ-13, SQ-14, and SQ-15: separated client/API, Vite/Express, modern responsive UI, persistence, schema validation, resilience, Git history, and a written cross-team contract. SQ-05 remains an open product decision because the existing web client deliberately uses `fetch`, not Axios; do not make a whole-client migration incidental to Shuttle work. SQ-08/SQ-29/SQ-30/SQ-33/SQ-42 become relevant only if the team deliberately advances the separate Reporting/Data Science roadmap.

The Gen AI and Data Science Main Quests (GE-01 through GE-07 and DA-01 through DA-07) retain their existing roadmap status. They are not Sprint 05 deliverables unless the team separately approves a documented Shuttle analytics problem, synthetic/consented dataset, contract, and evaluation plan. All 42 Side Quests remain tracked; none is marked complete by this plan.

### 4.3 Role-based work split

There is no separate job-description artifact in the repository. The integrated PRD and technology checklist define three learning-path roles: Full-Stack, Data Science, and Gen AI. The checklist's PIC names are planning suggestions, not authorization to assign work automatically. Use the following role split pending team confirmation:

| Role | Sprint 05 responsibility | Not automatically included |
| --- | --- | --- |
| Full-Stack | Domain rules, Prisma migration, Express API, React workflows, security, tests, API contract, acceptance evidence. | Changing ML architecture or external deployment. |
| Data Science | Review/define a future Shuttle data dictionary or reporting metric only if the team opens that separate scope. | Training/claiming a Shuttle forecast from operational data. |
| Gen AI | Review API/data-boundary implications only when AI consumes Shuttle data through a server-side contract. | Generative financial advice, automated settlement, or new RAG/intent work. |

## 5. Deliverables and technical implementation plan

| Priority | Deliverable | Backend/API and data work | Web work | Security/testing and acceptance | Complexity |
| --- | --- | --- | --- | --- | --- |
| P0 | Domain and policy decision record | Confirm subscriber identity, billing calendar, vendor/share formula, allowed state transitions, correction/refund rule, and role matrix before code. Update `docs/API-CONTRACT.md`. | Low-fidelity Shuttle workflow/wireframe retained as evidence for SQ-12 if the team elects that optional quest. | Signed-off rules are preconditions; no financial calculation is invented. | Medium |
| P0 | Route and subscription lifecycle | Complete paged/searchable tenant-scoped route/subscription reads and authorized lifecycle changes. Reject foreign/inactive dependencies and invalid dates. | Route and subscription lists, filters, create/edit/lifecycle actions, clear empty/error states. | HTTP/session/CSRF/RBAC/cross-tenant and lifecycle tests. | Medium |
| P0 | Billing period and invoice generation/finalization | Add a persisted billing-period boundary and unique generation constraint; generate and finalize within a transaction, with audited immutable invoice snapshots. Do a compatibility review before changing generic `Invoice`. | Period list/detail, preview of candidates, explicit generate/finalize confirmation and results. | Repeat/concurrent generation cannot create duplicate invoice; failed audit rolls back all changes. | High |
| P0 | Partial/multiple payment | Record payments against the authoritative outstanding amount, derive invoice status safely, and retain historical corrections through a non-destructive policy approved in the decision record. | Invoice detail, outstanding amount, payment entry, history, and clear validation messages. | Concurrent overpayment/replay, payment failure, audit rollback, RBAC, tenant isolation, and CSRF tests. | High |
| P0 | Vendor share and settlement | Replace or constrain the current free-text settlement provider model only after the vendor/share policy is approved. Persist period, basis, rate/amount snapshot, status, payment allocation, and audit record. | Vendor/settlement list and detail; show only finance-authorized values/actions. | Same payment cannot be settled twice; settlement is atomic and non-destructive. | High |
| P1 | Payment-proof attachment association | Validate that `entityType`/`entityId` resolves to an authorized same-tenant payment before accepting a proof. Reuse the existing allowed type/signature/hash/download controls. | Upload/download proof from the authorized payment screen; progress/error states. | Cross-tenant or nonexistent-parent attachment attempts fail; no storage orphan after rejected association. | Medium |
| P1 | Shuttle report | Define period-filtered operational metrics and expose a scoped report API. Keep billed, paid, outstanding, vendor share, cooperative share, and settled values distinct. | Filterable operational summary and drill-down links to invoices/settlements. | Reconcile report totals to fixture records; finance/read-role authorization tests. | Medium |

### 5.1 Planned file/module surface

The final names depend on the approved API contract. The minimum expected change surface is:

- `apps/api/prisma/schema.prisma` and one new additive Prisma migration.
- `apps/api/src/app.ts`, or an approved Shuttle-domain extraction from that file; no unrelated domain rewrite.
- Shuttle-focused API/unit tests and `apps/api/src/security.integration.test.ts`, which is the existing disposable PostgreSQL test harness.
- `apps/web/src/pages.tsx` or focused Shuttle components split from it, plus web tests and any response types in `apps/web/src/api.ts`.
- `packages/contracts/src/index.ts` only if a shared public Shuttle contract is introduced. Resolve its role-union mismatch with the API role set before relying on it for authorization types.
- `docs/API-CONTRACT.md`, `docs/SECURITY.md` if the threat surface changes, `docs/CODEX_HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/NOVO-PRD-COVERAGE.md`, and `docs/QUEST-TRACEABILITY.md`.

### 5.2 Database and migration strategy

The present schema lacks a billing-period entity and a structured Shuttle vendor/share model. The migration design must be finalized after policy decisions, but it must at minimum establish tenant-scoped uniqueness for a billing period and for an invoice generated for a subscription/period. It must preserve existing `Invoice`/`Payment` history, avoid destructive changes, and be tested against the existing Prisma migration chain.

Candidate entities or fields include a Shuttle billing-period record, a structured vendor reference or immutable vendor snapshot, share basis/rate/amount snapshots, settlement-payment allocation state, and operation/idempotency keys for repeated financial requests. They are design candidates, not approved schema commitments. A pre-migration inventory must identify every existing consumer of generic `Invoice`, `Payment`, `Settlement`, and `Attachment` so the generic models do not gain Shuttle-only semantics by accident.

Every financial mutation that changes invoice/payment/settlement state and its audit row must use one database transaction. Finalization, payment allocation, and settlement must use a concurrency-safe condition or suitable isolation level. Historical records are retained; cancellation, correction, or reversal semantics need an approved lifecycle rather than a hard delete.

## 6. Security and tenancy plan

1. Reuse the Sprint 02 opaque HttpOnly session, server-side fresh role/account checks, trusted-origin/CSRF middleware, and tenant ID from the session; no client-supplied tenant ID is accepted.
2. Write a Shuttle authorization matrix before endpoints are added. The current source allows route/subscription writes to Owner/Admin/Fleet Manager and invoice/payment actions to specific finance-capable roles. Settlement, vendor configuration, cancellation, correction, attachment upload, and report detail permissions require explicit team confirmation.
3. Scope every lookup, mutation, report, attachment-parent verification, invoice, payment, and settlement allocation by tenant. A foreign ID should behave as a safe not-found/denied response without leaking data.
4. Recompute billed/paid/outstanding/share values on the server from persisted records. The browser supplies an intent and permitted input, never the authoritative balance, status, vendor share, or settlement result.
5. Make mutation plus audit atomic. Protect duplicate billing, duplicate payment replay, overpayment, double settlement, and concurrent finalization with database constraints and transaction tests.
6. Treat payment references, proof files, and financial breakdowns as sensitive. Define response serializers and finance/read-role access before exposing settlement or share fields.

## 7. Testing and acceptance strategy

### Required automated evidence

- **Unit tests:** input/date/state validation, period boundaries, invoice and outstanding calculations, share calculation from approved policy, report aggregation, and response serialization.
- **PostgreSQL integration tests:** use the existing `NODE_ENV=test` plus `novo_ci`/`novo_test` guard and the real HTTP session/CSRF test helpers. Cover tenant isolation, roles, subscription/route lifecycle, invoice generation/finalization, concurrent/repeated generation, partial/multiple payment, concurrent overpayment, settlement allocation, attachment parent validation, and failure-injection rollback of financial/audit writes.
- **Web tests:** API error handling, loading/empty/denied states, form validation, payment/settlement UI flows, and redaction of finance-only details.
- **Regression and quality:** Prisma validate/generate/migrate deploy, workspace build, test, lint, `git diff --check`, and the existing Store/SKU/ML suites. A passing compile is not acceptance evidence.
- **Manual evidence when authorized:** use synthetic fixtures only to inspect the complete browser workflow and responsive layout. Do not claim staging authenticated E2E unless it is actually executed with authorization.

### Acceptance matrix

| Scenario | Pass condition |
| --- | --- |
| Subscription to final invoice | Authorized same-tenant user can create an eligible subscription, generate exactly one invoice for its billing period, explicitly finalize it, and see immutable historical data. |
| Partial/multiple payment | Payments cannot exceed the remaining amount; exact settlement changes the invoice status according to approved lifecycle; financial history is retained. |
| Vendor/share/settlement | Approved formula is snapshotted, a payment is allocated at most once per approved settlement rule, and report values reconcile to persisted records. |
| Payment proof | Only an authorized same-tenant user can attach/download an allowed, validated proof for an existing authorized payment. |
| Security | Missing/invalid CSRF, inactive user, insufficient role, foreign resource, forged price/balance/share, and duplicate/replayed request are denied without partial state. |
| Atomicity | Injected failure in an invoice, payment, settlement, attachment metadata, or audit step leaves balances, allocations, and audit history unchanged. |
| UI | The full Shuttle workflow has loading, empty, validation, success, failure, and access-denied states; no financial figures reserved for finance roles leak to other roles. |

## 8. Implementation order and definition of done

1. **Kickoff gate:** merge/review decision for Sprint 04 is recorded, create the implementation branch from the approved main baseline, preserve the current 86-row status, and obtain the policy decisions listed below.
2. **Contract first:** write the Shuttle state chart, financial formulas, role matrix, API request/response/error contract, and wireframe. Review generic invoice/payment/attachment consumers.
3. **Schema first:** implement additive schema/migration with database uniqueness and preflight/legacy-data checks. Generate Prisma client and validate migration deploy against disposable PostgreSQL.
4. **Vertical slice A:** route/subscription lifecycle plus pagination/search and security tests.
5. **Vertical slice B:** billing-period generation and finalization, server-side amounts, idempotency/concurrency protection, audit atomicity, and integration tests.
6. **Vertical slice C:** partial/multiple payment, approved correction policy, vendor/share settlement, proof association, and rollback tests.
7. **Vertical slice D:** Shuttle report and React screens; add web tests and manual synthetic-data inspection if authorized.
8. **Acceptance audit:** run the complete regression/CI matrix, reconcile the API contract and the five long-lived documentation files, record only observed results, then prepare a review PR. Do not merge automatically.

Sprint 05 is ready for review only when all primary FR-007 acceptance scenarios above are implemented and have real evidence, all regression checks pass, open business-policy choices are resolved in writing, and the documentation continues to mark unrelated 86-row requirements honestly. A route or UI alone is never sufficient.

## 9. Decisions and blockers requiring team confirmation

| Decision/blocker | Why it blocks a safe implementation |
| --- | --- |
| Subscriber identity | Current `ShuttleSubscription` uses `CooperativeMember`, while the PRD also identifies students as service identities and forbids student cooperative membership. Confirm whether a Shuttle subscriber can be a student/non-member and the approved identity relation. |
| Billing calendar and eligibility | Define period timezone/cutoff, route-rate effective date, pause/cancel behavior, proration, and which subscriptions qualify for generation. |
| Vendor and share formula | The PRD requires vendor/cooperative share and settlement but does not define vendor fields, basis, rate, tax/rounding, or adjustment policy. |
| Financial correction lifecycle | Define void/refund/reversal/late-payment behavior and whether allocation can be amended; never hard-delete financial history. |
| RBAC policy | Confirm who can configure routes, create/pause subscriptions, generate/finalize bills, record/reverse payments, settle vendors, view detailed shares, and access proofs. |
| Generic-model compatibility | Decide whether generic Invoice/Payment/Settlement remain cross-domain and how Shuttle-specific links/snapshots are introduced without breaking future Catering/Financing work. |
| Attachment association | Confirm the authoritative parent entity for a payment proof and its retention/authorization policy; generic attachment strings must not become an authorization bypass. |
| Documentation reconciliation | Resolve stale Sprint 03 historical wording in the long-lived tracking files before recording Sprint 05 evidence. |

**MED-01 remains open:** scheduled import-preview retention purge must be independently implemented and verified before any production processing of real personal data. It is tracked, but not a Shuttle feature.

## 10. Codex implementation checklist

- [ ] Confirm policy decisions and scope in Section 9.
- [ ] Start an implementation branch only after the approved Sprint 04 baseline is available; do not rewrite history.
- [ ] Update API contract and Shuttle state/authorization design before schema edits.
- [ ] Add the minimal additive Prisma migration and validate legacy compatibility.
- [ ] Implement one tested backend vertical slice at a time.
- [ ] Implement matching React workflow and web tests after its backend contract stabilizes.
- [ ] Add real PostgreSQL integration tests using only a disposable database.
- [ ] Run Prisma validation/generation/migration deploy, build, test, lint, and diff checks.
- [ ] Update Sprint handoff, PRD coverage, implementation status, Quest traceability, and acceptance evidence using observed outputs only.
- [ ] Create a review PR only after the acceptance audit; do not merge automatically.

# CP6-A2-04J Selective Merge Report

**Workspace:** isolated candidate `novo-merge-s05-s06-20261109-141214`  
**Base commit:** `a82c471cff4c7921464c7136c1f426329a80d83b`  
**Scope:** offline-only selective A2 hardening. No candidate commit, no original-repository write, no database action, and no dependency installation occurred.

## Baseline and preservation evidence

- Candidate branch/HEAD remained `codex/merge-s05-s06-20261109-141214` / `a82c471cff4c7921464c7136c1f426329a80d83b`.
- The original remained `codex/sprint-05-planning` at the same HEAD, with an empty index and 74 reported WIP paths after this checkpoint.
- Seven pre-edit candidate sources were byte-copied to `C:\Users\raden\Documents\Codex\novo-a2-isolated-reconstruction\04J-backup-20261109-150000`; this checkpoint did not modify the original, A2 reference, or historical-migration quarantine.
- Migration `008`, `009`, and `010` have zero candidate diff lines from `HEAD`. Their observed SHA-256 values are respectively `58281D57EFFA648614BF22D6DD3FBD794CF430DBC96C08C39A2FA03C7E7729D4`, `F0F9E7879D2FE92E931BD86FA33AA752CE3CFBE30B822EF0C99B5E0C1F285E88`, and `092DA19CCA16F0B8E63691D55DCA15C026A811F156DBEC77A313918A9A5E89F3`.

The historical quarantine intentionally differs from `HEAD` for 008/009 and was not treated as a candidate migration source.

## Selective A2 changes

| Area | Change | Reason |
| --- | --- | --- |
| Subscription responses | Explicit Prisma select/serializer now serves both POST and GET. It excludes tenant ID, payer contact, full student records, and invoice history. | Prevent relation over-disclosure while retaining the minimal rider/route fields used by Shuttle UI. |
| Money contract | Subscription effective rate and route rate are validated and serialized as safe whole-Rupiah JSON numbers. | Align POST/GET response contract without using decimal strings or silent rounding. |
| Cashier collection | Collectible selector now requires a `shuttleBillingPeriodId`; its SQL count and fetch phases use the same restriction. | Prevent Cashier selection from becoming a tenant-wide generic invoice browser. |
| Payment idempotency | A duplicate tenant reference with the same invoice/method/amount returns the persisted payment and `idempotentReplay: true`; a mismatched reuse returns `409 PAYMENT_REFERENCE_REUSED`. | Preserve exactly-once accounting and audit behavior under retries. |
| Settlement concurrency | Existing tenant/period settlement returns a replay response. A real unique-conflict race is reconciled by re-reading only that tenant/period. | Avoid duplicate settlements/allocation while retaining serializable retries. |
| Calendar/proration | Generation derives days from stored Jakarta period bounds and rejects a sub-one-Rupiah prorated invoice before persistence. | Fix UTC month-shift risk and prevent a migration-010 snapshot CHECK violation. |
| RBAC policy | `FINANCE_OFFICER` is explicitly included in the provisional finance read/verify/finalize set; Cashier remains limited to selector/recording, and payout transition endpoints remain Treasurer/authority restricted. | Make the implemented least-privilege boundary explicit without claiming business approval. |
| P2002 mapping | The Shuttle unique-index classifier now accepts only exact field tuples, exact approved index names, or full PostgreSQL identifier boundaries. | Avoid classifying unrelated/mixed P2002 metadata as Shuttle duplication. |

The generic `GET /billing/invoices` and generic payment behavior were intentionally not narrowed: they are shared contracts. Shuttle settlement still selects only verified payments whose invoices belong to its Shuttle billing period.

## Migration 011 (draft only; NOT APPLIED)

`apps/api/prisma/migrations/202611090011_shuttle_financial_tenant_integrity/migration.sql` is a new additive, unapplied migration draft. It adds `BEFORE INSERT OR UPDATE` PostgreSQL guards for:

1. Invoice tenant = Shuttle billing-period and subscription tenant when those references exist.
2. Payment tenant = invoice tenant.
3. ShuttleSettlement tenant = billing-period tenant.
4. ShuttleSettlementPayment tenant and billing-period = its settlement's tenant and period.

It intentionally makes no schema/Prisma-model change and does not rewrite migrations 008–010. It must be exercised only on a newly approved disposable A2 database before inclusion in any commit.

## Regression coverage added or strengthened

- Subscription GET/POST regression now asserts numeric rate fields and the absence of `tenantId`, `payerContact`, invoice history, member email, and member phone.
- Cashier collectible fixture now represents a valid period-backed Shuttle invoice rather than a generic invoice.
- Repeating an identical whole-Rupiah payment assertion verifies `200`, `idempotentReplay: true`, and exactly two persisted payments.
- Financial fixture data now satisfies migration-010 Shuttle snapshot constraints.
- Billing unit coverage checks Jakarta period day calculation across the year boundary and leap February.
- P2002 unit coverage rejects duplicated fields, mixed target arrays, and index-name prefix/suffix lookalikes.

## Quality-gate evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Candidate/original Git identity | PASS | Branches and HEAD observed as stated above. |
| Historic migration immutability | PASS | 008–010 have zero diff lines from candidate HEAD; 010 retains its required SHA-256. |
| `git diff --check` | PASS | Exit code 0. Windows LF/CRLF warnings were emitted only for existing working-copy conversion notices. |
| Prisma validate/generate | BLOCKED | Candidate has no checked-in `apps/api/node_modules/.bin/prisma.cmd`; no install or package-manager fallback was permitted. |
| Workspace build/lint | BLOCKED | Candidate has no checked-in compiler/linter binaries; no dependency installation was permitted. |
| Focused unit/integration tests | NOT RUN | Dependencies are absent. Integration tests are deliberately deferred: no disposable database was approved or touched. |

## Policy status and remaining risks

D05-01 through D05-07 remain **PROVISIONAL**. This work does not approve actual riders, rate rules, share percentages, vendor payouts, refunds, retention, or production RBAC. FR-007 remains PARTIAL; MED-01 remains OPEN.

Before any merge/commit decision, require a fresh disposable PostgreSQL A2 QA environment (not ports 55433/55434 and not an A1 volume) with explicit identity/port/database preflight. Apply 001–011 there only, then run Prisma validation/generation, focused billing/uniqueness units, the full A1+A2 integration suite, and direct SQL tests for all four migration-011 trigger invariants. Confirm that the trigger error behavior and generic Invoice/Payment consumers remain compatible before considering deployment.

## Incremental patch artifact

An incremental, path-scoped 04J patch is exported outside both repositories at `C:\Users\raden\Documents\Codex\novo-a2-isolated-reconstruction\patches\CP6-A2-04J-incremental-hardening-20261109.patch`. It compares only the A2 paths touched by this checkpoint against the preserved original WIP and adds migration 011/report artifacts. It intentionally is not a full candidate-WIP patch, so it cannot pull F4/A3 work by accident. Its final SHA-256 is recorded with the handoff after export. A non-mutating `git apply --check --ignore-space-change` against the original WIP passed; the whitespace flag is required only because the two Windows working trees report existing LF/CRLF conversion warnings.

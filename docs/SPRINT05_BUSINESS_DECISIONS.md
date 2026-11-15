# Sprint 05 Shuttle Business Decision Record

**Status:** Sprint 05 team development policy.  
**Effect:** The policy below guides the additive implementation. It does not claim approval of any concrete tariff, vendor contract, bank transfer, or real operational data.

## Adopted implementation policy

- Billing periods are monthly `Asia/Jakarta` calendar intervals. Proration is deterministic half-up integer Rupiah: `rate × active days / days in period`.
- A generated invoice snapshots route and effective rate; finalization prevents further generation for that period.
- Cashier entries are `RECORDED`; only finance authorization verifies them. Reversal retains the payment record and removes it from verified balances.
- Vendor and cooperative shares are explicit basis-point configuration and must total exactly 10,000 (100%); no 80/20 default exists.
- **Provisional money boundary:** Shuttle operational amounts use whole Rupiah only. API inputs reject fractional, non-finite, negative, zero, and out-of-range values; server-side financial aggregation uses exact integer arithmetic. This prevents silent rounding while finance/PIC confirms whether real operational data ever requires sub-Rupiah precision.
- Student subscribers are tenant-scoped. A guardian may be recorded as payer metadata. The legacy cooperative-member path remains for existing compatible records.

## Purpose

FR-007 requires Shuttle subscription, billing, payment, settlement, and reporting. The source PRD does not set the financial formulas, detailed calendar policy, or full authorization matrix needed to safely implement the remaining workflow. This record separates those undecided rules from the safe, already-existing Shuttle foundations.

## Existing implementation boundary

The current `ShuttleSubscription` schema links to `CooperativeMember`. Its creation endpoint therefore accepts only an active same-tenant teacher/employee cooperative member. That is existing behavior, not a newly approved Shuttle-customer policy. The NOVO PRD also identifies students as service identities while prohibiting them from becoming cooperative members. Sprint 05 must not silently treat those distinct concepts as equivalent.

## Decisions awaiting confirmation

| ID | Topic | Proposed direction | Why confirmation is required | Current implementation effect |
| --- | --- | --- | --- | --- |
| D05-01 | Shuttle subscriber identity | Introduce an explicit Shuttle subscriber relation to an eligible NOVO identity, so the final policy can distinguish student, teacher/employee, cooperative member, guardian, and approved external rider. | The PRD defines identity separation but does not say which identity types may subscribe to Shuttle. | No schema change. Existing cooperative-member-only creation remains unchanged. |
| D05-02 | Billing period and proration | Use a tenant-scoped calendar period with explicit start/end/cutoff and a one-invoice-per-subscription-per-period invariant. Do not apply proration unless the PIC approves its trigger and formula. | The PRD requires billing generation/finalization, but does not define monthly cutoff, timezone, rate-effective date, pause/cancel treatment, or proration. | No billing-period model or batch generation is added. |
| D05-03 | Vendor and cooperative share | Store the approved basis, rate, recipient, and resulting amount as immutable snapshots on the settlement. The rate must come from approved configuration, never the browser. | The PRD requires vendor/cooperative share and settlement but specifies no percentage, tax treatment, rounding, or payment-allocation rule. | No vendor or settlement mutation is added. |
| D05-04 | Correction, refund, and cancellation | Retain financial history and use a reasoned void/reversal/adjustment lifecycle with audit records; never hard-delete invoices, payments, or settlements. | The PRD establishes non-destructive financial history but does not define when an invoice/payment can be corrected or refunded. | No correction/refund endpoint is added. |
| D05-05 | Financial RBAC | **PROVISIONAL:** Cashier may query the tenant-scoped, minimal collectible-invoice selection contract solely to record a payment. Cashier remains excluded from full invoice/payment history, verification, reversal, void, settlement, sharing configuration, and financial reporting. | Existing endpoint roles are a technical baseline, not a complete approved finance authorization policy. | Requires PIC/business approval before deployment; server-side least-privilege checks remain mandatory. |
| D05-06 | Generic Invoice and Payment models | Keep generic `Invoice` and `Payment` reusable across domains. Add Shuttle-specific period, snapshot, and settlement associations only after reviewing all current/future consumers. | A Shuttle-only migration on generic models can break Catering/Financing evolution or blur domain metrics. | No migration is added. |
| D05-07 | Payment proof attachment | Bind a payment proof only after the API validates an existing same-tenant authorized payment; retain current signature/hash/type/download safeguards. | The attachment table is polymorphic and its generic entity fields alone are not a financial-entity authorization policy. | No attachment flow is changed yet. |

## Safe foundations implemented before these decisions

The following technical controls do not choose a financial formula or customer policy and may proceed independently:

- Validate that an optional subscription end date is not before its start date.
- Paginate/filter tenant-scoped Route and Subscription reads.
- Make existing Route, Subscription, Invoice, and Payment mutation audit records atomic with their business write.
- Use serializable transaction retry for existing invoice payment recording to prevent concurrent overpayment.
- Prove these controls using the disposable PostgreSQL integration-test harness.

## Approval checklist

- [ ] PIC/team confirms the permitted subscriber identity types and any guardian/external-rider rule.
- [ ] PIC/team confirms billing calendar, timezone, rate-effective date, pause/cancel behavior, and proration policy.
- [ ] Finance/PIC confirms vendor/share basis, rates, rounding, taxes, and settlement allocation rule.
- [ ] Finance/PIC confirms correction/refund/reversal lifecycle and required approval/audit trail.
- [ ] Team approves the Shuttle RBAC matrix and sensitive-field response policy.
- [ ] Team approves the generic-model migration design and legacy-data/preflight plan.
- [ ] Team approves the authoritative payment-proof attachment parent and retention policy.

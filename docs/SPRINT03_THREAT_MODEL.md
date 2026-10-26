# Sprint 03 threat model — Master Data, Excel, and membership

## Scope and trust boundary

Sprint 03 uses synthetic Master Data. The server-side session derives tenant, actor, role and active status. The browser can provide an XLSX and confirmation parameters, but it cannot provide tenant identity, a role, import authority, membership eligibility, or a source system override.

| Threat | Control | Evidence |
| --- | --- | --- |
| Forged tenant, role, active state or browser bearer | Opaque HttpOnly revocable session, fresh user lookup, trusted origin and CSRF; tenant predicate on every route; no browser bearer storage | Sprint 02 security suite and Sprint 03 negative cases in `security.integration.test.ts` |
| Partial or malformed Excel row | Exact official headers; empty rows are ignored; non-empty rows require `identifier` and `fullName` and report their row/field | `safeRequired` plus 4-case `master-data-import.test.ts` |
| Macro, formula, external link, ZIP bomb or oversized workbook | XLSX MIME/extension and ZIP inspection; reject unsafe paths/encryption/macro/external link/formula, 2 MiB input, 500 rows, unsafe expansion | `master-data-import.ts`; corrupted/formula integration cases |
| Duplicate or concurrent import | NFKC/whitespace/case normalization of type plus identifier; unique database key; serializable transaction claims preview once | Duplicate unit case plus concurrent integration case |
| Replay, stale, tampered, foreign preview | Preview stores actor, tenant, fingerprint, expiry and consumed-at state; commit filters all fields and atomically consumes once | Same-tenant-other-user, foreign-tenant, expiry, tamper and replay integration cases |
| Cross-tenant or unsafe membership status | Status route requires admin and CSRF, scopes by tenant, and requires active non-student linked identity before activation | Lifecycle, inactive and foreign mutation integration cases |
| Student or inactive cooperative use | Creation and reactivation reject students/inactive identities; downstream funding, financing and shuttle guard derives current eligibility | `requireEligibleCooperativeMember` and membership integration cases |
| Audit leakage or raw workbook retention | Audit stores summary/source/key metadata; raw XLSX bytes are never written to database or disk | import route and audit assertion; see MED-01 for structured preview cleanup |

## Lifecycle policy

A teacher or employee may be deactivated without deleting historical membership or finance references. That immediately prevents new cooperative-benefit operations. An administrator may reactivate a member only if the linked record remains an active teacher or employee in the same tenant. A student and a legacy unlinked member can never be activated through this lifecycle. Every create, deactivate and activate event is auditable.

## Residual risk

Preview expiration is enforced for authorization, but structured preview rows are lazily deleted rather than purged by a scheduled job. The raw uploaded workbook is not stored. Add an operational retention purge before using real personal data in production.

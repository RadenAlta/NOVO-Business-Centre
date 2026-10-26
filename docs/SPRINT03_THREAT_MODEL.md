# Sprint 03 threat model — Master Data, Excel, and membership

## Scope and security boundary

Sprint 03 handles synthetic Master Data only. The authenticated server session supplies the tenant, actor, and current role; browser claims for these fields are never accepted. The browser receives a short-lived preview identifier and fingerprint, not authority to decide what is written.

| Threat | Control | Acceptance evidence |
| --- | --- | --- |
| Forged tenant, role, or active state | Every route uses the Sprint 02 cookie session, CSRF/origin middleware, current database role, and tenant-scoped queries. Import payloads have no tenant/role/active fields. | Integration negative cases for viewer and cross-tenant reads/writes/imports. |
| Corrupted, spoofed, macro-capable, external-reference, or oversized workbook | Accept only `.xlsx` Open XML MIME/extension plus ZIP signature; inspect archive entry count/size/path, reject macro/external-link entries, formulas, unsupported sheets, files above 2 MiB, and more than 500 data rows. Parsing stays in memory. | Integration tests for malformed/formula workbooks and upload limits. |
| Formula injection in template or import | Templates escape formula-leading string cells. Imports reject formula cells and formula-leading field values before preview. | Template and formula rejection tests. |
| Duplicate identifiers or concurrent import commits | Normalize `type + identifier`; detect in-file duplicates; create/update in a tenant-scoped serializable transaction. Preview consumption is atomic so one preview cannot commit twice. | Duplicate, retry, and concurrent-commit tests. |
| Stale/tampered preview | Store normalized parsed rows, server fingerprint, tenant, actor, expiry, and consumption state. Commit only consumes a matching, unexpired preview and reclassifies against current database data. | Tampered fingerprint and expired-preview tests. |
| Overwrite of SIMS-managed identity | Manual imports classify matching `dataSource=SIMS` rows as `skip`; they do not overwrite fields. Manual create/update paths do not accept source or external SIMS identifiers from the browser. | SIMS conflict preview/commit tests. |
| Ineligible or inactive cooperative membership | New membership requires an active same-tenant `TEACHER` or `EMPLOYEE` identity. Student, inactive, foreign, duplicate, and legacy-unlinked identities cannot create a new membership. Existing historical memberships remain readable; downstream eligibility is derived from current identity status. | Membership integration cases and eligibility UI state. |
| Private data in audit logs or retained uploads | The workbook bytes are never persisted. Preview rows are transient for ten minutes. Audit events store counts, source, keys, and actor—not row payloads, contact fields, or spreadsheet bytes. | Import audit assertions and source review. |

## Import policy

Preview never writes Master Data. Commit is all-or-nothing for create/update rows: any row validation error blocks commit. Matching manual records are updated; matching SIMS-managed records are intentionally skipped; no source override exists in this sprint. A database conflict caused by a newer concurrent import aborts the whole transaction and returns a retryable conflict. This bounded transaction contains at most 500 rows.

## Membership lifecycle policy

Deactivating a teacher or employee does not delete its membership or historical finance references. It makes the identity ineligible for new membership creation and new cooperative-benefit operations until reactivated. Legacy memberships with no linked identity remain available for historical display but are ineligible for new benefit operations.
# Sprint 04 — Store SKU Integrity (HIGH-02)

## Canonical contract

A Product SKU is a 2–50 character ASCII identifier matching `[A-Z0-9][A-Z0-9._/-]{1,49}`. The API accepts lowercase input only so it can return/store the canonical uppercase form. Whitespace, Unicode characters and other punctuation are rejected rather than silently transformed. The database also requires byte length to equal character length, so a database write cannot exploit collation-dependent character ranges to store non-ASCII text.

This restriction is deliberate: for the allowed ASCII alphabet, TypeScript `trim().toUpperCase()` and PostgreSQL `upper(btrim(sku))` have the same semantics. It removes locale- and Unicode-folding ambiguity from a financial/inventory identifier.

## Safe deployment procedure

1. Take the normal database backup/change-control checkpoint.
2. Run the read-only report: `pnpm --filter @novo/api preflight:store-sku`.
3. Manually reconcile every reported invalid value or same-tenant normalized collision. The report includes tenant ID, product ID and original SKU values.
4. Rerun the preflight until it exits 0, then deploy migrations.

The migration independently repeats the preflight and aborts before any update if it finds invalid legacy values or a normalized collision. It never deletes products, merges records, appends suffixes, or selects a winner. After a clean preflight it uppercases valid legacy Product SKU values to match the API contract. Product IDs, sale records and `SaleItem.productSku` historical snapshots are not changed.

## Database boundary

The existing unique index on `("tenantId", "sku")` is retained. The new PostgreSQL CHECK constraint only permits canonical uppercase ASCII SKU storage, so that ordinary unique index is now case-insensitive by construction and protects direct database writes that bypass the API.

Prisma schema syntax can express the ordinary composite unique index but not this SQL CHECK constraint (nor a portable functional unique-expression index). The SQL migration is therefore the authoritative representation of the database-level canonical-storage rule. Do not remove it during Prisma introspection or a future migration review.

## Verification boundary

The migration and PostgreSQL integration tests must run in GitHub Actions before HIGH-02 can be closed. Local source/type checks do not prove a migration against a database containing real legacy SKU data.
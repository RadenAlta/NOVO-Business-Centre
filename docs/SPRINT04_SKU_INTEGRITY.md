# Sprint 04 — Store SKU Integrity (HIGH-02)

## Canonical contract

A Product SKU is a 2–50 character ASCII identifier matching `[A-Z0-9][A-Z0-9._/-]{1,49}` in canonical storage. The API accepts lowercase input so it can return/store the canonical uppercase form. The database also requires byte length to equal character length, so a database write cannot exploit collation-dependent character ranges to store non-ASCII text.

This restriction is deliberate: the API validates the original, untrimmed ASCII input and then applies TypeScript `toUpperCase()`. PostgreSQL stores uppercase ASCII. The legacy migration uses `upper(btrim(sku))` only after its preflight rejects outer whitespace. This removes locale- and Unicode-folding ambiguity from financial/inventory identifiers.

## Safe deployment procedure

1. Confirm that migration `202610280006_store_sku_integrity` has **not** already been applied to any persistent environment. This repository contains no persistent deployment configuration or migration-status evidence; the release owner must verify the target with `prisma migrate status` and deployment logs before this migration file is changed or deployed. Never edit the migration after a persistent environment has recorded its checksum.
2. Take the normal database backup/change-control checkpoint and announce a short Product-write maintenance window. Read-only Product queries may continue, but application and direct database Product writes must be quiesced.
3. Run the read-only report: `pnpm --filter @novo/api preflight:store-sku`.
4. Manually reconcile every reported invalid value or same-tenant normalized collision. The report includes tenant ID, product ID and original SKU values.
5. Rerun the preflight until it exits 0, then deploy migrations while the write window is active. Record `prisma migrate status`, the deployment log, and the migration ID in the change record.

The migration is one explicit PostgreSQL transaction. It takes `SHARE ROW EXCLUSIVE` on `"Product"` before the repeated preflight, uses a five-second local lock timeout, canonicalizes only clean valid values, and installs the CHECK before committing. Product INSERT/UPDATE/DELETE operations conflict with that lock, so a direct writer cannot pass between preflight and the constraint. If the lock timeout or preflight fails, PostgreSQL rolls the whole transaction back before any legacy SKU is rewritten. It never deletes products, merges records, appends suffixes, or selects a winner. Product IDs, sale records and `SaleItem.productSku` historical snapshots are not changed.

If deployment records a failed migration, first inspect the database, migration logs, and affected Product rows. Reconcile data manually, then use `prisma migrate resolve --rolled-back 202610280006_store_sku_integrity` only after confirming that the failed transaction made no schema/data change; rerun the preflight and deploy. Do not use `prisma migrate reset` in a persistent environment. Do not edit an already-applied migration to change its checksum.

## Database boundary

The existing unique index on `("tenantId", "sku")` is retained. The new PostgreSQL CHECK constraint only permits canonical uppercase ASCII SKU storage, so that ordinary unique index is now case-insensitive by construction and protects direct database writes that bypass the API.

Prisma schema syntax can express the ordinary composite unique index but not this SQL CHECK constraint (nor a portable functional unique-expression index). The SQL migration is therefore the authoritative representation of the database-level canonical-storage rule. Do not remove it during Prisma introspection or a future migration review.

## Verification boundary

`pnpm --filter @novo/api test:legacy-sku-migration` creates isolated disposable fixture databases only when its source database is the CI/test database (`novo_ci` or `novo_test`). It tests valid legacy canonicalization with preserved references/snapshots, invalid legacy failure/recovery, same-tenant collision failure without a chosen winner, cross-tenant reuse, and a two-connection Product-write race during the lock window. GitHub Actions runs this explicit stage before the ordinary `prisma migrate deploy` step.

CP4-D2-R2 changes API validation to reject leading and trailing whitespace before uppercase canonicalization. The product create and update routes share this strict schema. Endpoint regression testing and GitHub Actions acceptance remain required before HIGH-02B can be closed.

The migration safety harness and PostgreSQL integration tests must run in GitHub Actions before HIGH-02A can be closed. Local source/type checks do not prove a migration against a database containing real legacy SKU data.

-- Product SKU integrity: API and database share the same canonical ASCII form.
-- Do not resolve the reported conflicts automatically: a business owner must reconcile them.
BEGIN;

-- Keep the migration bounded during the announced write-quiescence window.
-- A lock timeout aborts this transaction before any legacy SKU is rewritten.
SET LOCAL lock_timeout = '5s';

LOCK TABLE "Product" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  invalid_detail TEXT;
  collision_detail TEXT;
BEGIN
  SELECT string_agg(format('tenantId=%s productId=%s sku=%L', "tenantId", "id", "sku"), E'\n')
  INTO invalid_detail
  FROM (
    SELECT "tenantId", "id", "sku"
    FROM "Product"
    WHERE "sku" IS NULL
      OR "sku" !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$'
      OR octet_length("sku") <> char_length("sku")
    ORDER BY "tenantId", "id"
    LIMIT 25
  ) AS invalid_rows;

  IF invalid_detail IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'NOVO SKU integrity preflight failed: invalid legacy SKU values.',
      DETAIL = invalid_detail,
      HINT = 'Resolve every listed product manually, run pnpm --filter @novo/api preflight:store-sku, then retry migration.';
  END IF;

  SELECT string_agg(
    format('tenantId=%s canonicalSku=%L products=[%s]', "tenantId", normalized_sku, products),
    E'\n'
  )
  INTO collision_detail
  FROM (
    SELECT
      "tenantId",
      upper(btrim("sku")) AS normalized_sku,
      string_agg(format('productId=%s sku=%L', "id", "sku"), ', ' ORDER BY "id") AS products
    FROM "Product"
    GROUP BY "tenantId", upper(btrim("sku"))
    HAVING COUNT(*) > 1
    ORDER BY "tenantId", normalized_sku
    LIMIT 25
  ) AS collisions;

  IF collision_detail IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'NOVO SKU integrity preflight failed: normalized SKU collisions require manual reconciliation.',
      DETAIL = collision_detail,
      HINT = 'Do not delete, merge, suffix, or choose a winner automatically. Resolve the affected products explicitly, run pnpm --filter @novo/api preflight:store-sku, then retry migration.';
  END IF;
END $$;

-- Only valid, non-conflicting legacy values reach this statement. Product IDs and sale-item snapshots are untouched.
UPDATE "Product"
SET "sku" = upper(btrim("sku"))
WHERE "sku" <> upper(btrim("sku"));

-- Canonical storage lets the existing tenantId+sku unique index enforce case-insensitive uniqueness.
-- Prisma cannot express this PostgreSQL CHECK constraint, so it remains represented in this SQL migration.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_sku_canonical_ascii_check"
  CHECK (
    "sku" ~ '^[A-Z0-9][A-Z0-9._/-]{1,49}$'
    AND octet_length("sku") = char_length("sku")
  );

COMMIT;

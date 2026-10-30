-- Sprint 04: idempotency for receipt and adjustment stock movements.
-- Historical movements retain NULL keys and fingerprints.
-- No existing inventory balance or payment data is rewritten.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "StockMovement"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "inputFingerprint" TEXT;

-- New idempotent movements must store both fields together.
-- Historical movements with both NULL values remain valid.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_inventory_idempotency_pair_check"
  CHECK (
    (
      "idempotencyKey" IS NULL
      AND "inputFingerprint" IS NULL
    )
    OR
    (
      "idempotencyKey" IS NOT NULL
      AND "inputFingerprint" IS NOT NULL
    )
  );

-- PostgreSQL permits multiple NULL values in this unique index.
-- Non-NULL keys are unique within each tenant, across both operations.
CREATE UNIQUE INDEX "StockMovement_tenantId_idempotencyKey_key"
  ON "StockMovement"("tenantId", "idempotencyKey");

COMMIT;

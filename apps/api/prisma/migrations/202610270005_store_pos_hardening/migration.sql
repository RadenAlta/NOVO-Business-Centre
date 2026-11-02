-- Sprint 04 extends the existing Store vertical slice without deleting history.
CREATE TYPE "StorePaymentStatus" AS ENUM ('RECORDED');

CREATE TABLE "ProductCategory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product"
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "unitCost" DECIMAL(14,2),
  ADD COLUMN "stockOnHand" INTEGER NOT NULL DEFAULT 0;

UPDATE "Product" AS product
SET "stockOnHand" = COALESCE((
  SELECT SUM("quantity")::INTEGER FROM "StockMovement" AS movement
  WHERE movement."productId" = product."id"
), 0);

ALTER TABLE "StockMovement"
  ADD COLUMN "balanceAfter" INTEGER,
  ADD COLUMN "performedById" TEXT,
  ADD COLUMN "saleId" TEXT;

ALTER TABLE "Sale"
  ADD COLUMN "customerIdentityId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "inputFingerprint" TEXT,
  ADD COLUMN "totalCost" DECIMAL(14,2),
  ADD COLUMN "grossMargin" DECIMAL(14,2),
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedById" TEXT;

ALTER TABLE "SaleItem"
  ADD COLUMN "productSku" TEXT,
  ADD COLUMN "productName" TEXT,
  ADD COLUMN "unitCost" DECIMAL(14,2),
  ADD COLUMN "costSubtotal" DECIMAL(14,2),
  ADD COLUMN "grossMargin" DECIMAL(14,2);

UPDATE "SaleItem" AS item
SET "productSku" = product."sku", "productName" = product."name"
FROM "Product" AS product
WHERE product."id" = item."productId";

ALTER TABLE "SaleItem"
  ALTER COLUMN "productSku" SET NOT NULL,
  ALTER COLUMN "productName" SET NOT NULL;

CREATE TABLE "StorePayment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "StorePaymentStatus" NOT NULL DEFAULT 'RECORDED',
  "amount" DECIMAL(14,2) NOT NULL,
  "cashReceived" DECIMAL(14,2),
  "changeGiven" DECIMAL(14,2),
  "reference" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductCategory_tenantId_name_key" ON "ProductCategory"("tenantId", "name");
CREATE INDEX "ProductCategory_tenantId_active_name_idx" ON "ProductCategory"("tenantId", "active", "name");
CREATE INDEX "Product_tenantId_categoryId_active_idx" ON "Product"("tenantId", "categoryId", "active");
CREATE INDEX "StockMovement_tenantId_saleId_idx" ON "StockMovement"("tenantId", "saleId");
CREATE UNIQUE INDEX "Sale_tenantId_idempotencyKey_key" ON "Sale"("tenantId", "idempotencyKey");
CREATE INDEX "Sale_tenantId_status_occurredAt_idx" ON "Sale"("tenantId", "status", "occurredAt");
CREATE UNIQUE INDEX "StorePayment_saleId_key" ON "StorePayment"("saleId");
CREATE UNIQUE INDEX "StorePayment_tenantId_reference_key" ON "StorePayment"("tenantId", "reference");
CREATE INDEX "StorePayment_tenantId_method_recordedAt_idx" ON "StorePayment"("tenantId", "method", "recordedAt");

ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerIdentityId_fkey" FOREIGN KEY ("customerIdentityId") REFERENCES "MasterDataRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorePayment" ADD CONSTRAINT "StorePayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorePayment" ADD CONSTRAINT "StorePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorePayment" ADD CONSTRAINT "StorePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

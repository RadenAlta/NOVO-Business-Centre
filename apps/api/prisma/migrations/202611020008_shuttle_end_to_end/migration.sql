-- Additive Shuttle lifecycle. Existing generic Invoice, Payment, and Settlement data remains intact.
CREATE TYPE "ShuttleBillingPeriodStatus" AS ENUM ('OPEN', 'FINALIZED');
CREATE TYPE "ShuttlePaymentStatus" AS ENUM ('RECORDED', 'VERIFIED', 'REVERSED');
CREATE TYPE "ShuttleSettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

ALTER TABLE "ShuttleSubscription" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "ShuttleSubscription" ADD COLUMN "studentIdentityId" TEXT,
ADD COLUMN "effectiveMonthlyRate" DECIMAL(14,2),
ADD COLUMN "payerName" TEXT,
ADD COLUMN "payerContact" TEXT;
ALTER TABLE "ShuttleSubscription" ADD CONSTRAINT "ShuttleSubscription_studentIdentityId_fkey" FOREIGN KEY ("studentIdentityId") REFERENCES "MasterDataRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShuttleBillingPeriod" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta', "status" "ShuttleBillingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "finalizedAt" TIMESTAMP(3), "finalizedById" TEXT,
  CONSTRAINT "ShuttleBillingPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShuttleBillingPeriod_tenantId_startsAt_key" ON "ShuttleBillingPeriod"("tenantId", "startsAt");
CREATE INDEX "ShuttleBillingPeriod_tenantId_status_startsAt_idx" ON "ShuttleBillingPeriod"("tenantId", "status", "startsAt");
ALTER TABLE "ShuttleBillingPeriod" ADD CONSTRAINT "ShuttleBillingPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShuttleFinancialConfig" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "vendorName" TEXT NOT NULL, "vendorShareBps" INTEGER NOT NULL,
  "cooperativeShareBps" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ShuttleFinancialConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShuttleFinancialConfig_share_total_check" CHECK ("vendorShareBps" >= 0 AND "cooperativeShareBps" >= 0 AND "vendorShareBps" + "cooperativeShareBps" = 10000)
);
CREATE UNIQUE INDEX "ShuttleFinancialConfig_tenantId_key" ON "ShuttleFinancialConfig"("tenantId");
ALTER TABLE "ShuttleFinancialConfig" ADD CONSTRAINT "ShuttleFinancialConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD COLUMN "shuttleBillingPeriodId" TEXT, ADD COLUMN "finalizedAt" TIMESTAMP(3), ADD COLUMN "finalizedById" TEXT,
ADD COLUMN "routeCodeSnapshot" TEXT, ADD COLUMN "routeNameSnapshot" TEXT, ADD COLUMN "rateSnapshot" DECIMAL(14,2),
ADD COLUMN "proratedDays" INTEGER, ADD COLUMN "periodDays" INTEGER;
CREATE UNIQUE INDEX "Invoice_tenantId_subscriptionId_shuttleBillingPeriodId_key" ON "Invoice"("tenantId", "subscriptionId", "shuttleBillingPeriodId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shuttleBillingPeriodId_fkey" FOREIGN KEY ("shuttleBillingPeriodId") REFERENCES "ShuttleBillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD COLUMN "status" "ShuttlePaymentStatus" NOT NULL DEFAULT 'VERIFIED', ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verifiedById" TEXT, ADD COLUMN "reversedAt" TIMESTAMP(3), ADD COLUMN "reversedById" TEXT, ADD COLUMN "reversalReason" TEXT;

CREATE TABLE "ShuttleSettlement" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "billingPeriodId" TEXT NOT NULL, "vendorNameSnapshot" TEXT NOT NULL,
  "vendorShareBps" INTEGER NOT NULL, "cooperativeShareBps" INTEGER NOT NULL, "verifiedAmount" DECIMAL(14,2) NOT NULL,
  "vendorAmount" DECIMAL(14,2) NOT NULL, "cooperativeAmount" DECIMAL(14,2) NOT NULL, "status" "ShuttleSettlementStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt" TIMESTAMP(3), "approvedById" TEXT, "paidAt" TIMESTAMP(3), "paidById" TEXT, "paymentReference" TEXT,
  CONSTRAINT "ShuttleSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShuttleSettlement_share_total_check" CHECK ("vendorShareBps" >= 0 AND "cooperativeShareBps" >= 0 AND "vendorShareBps" + "cooperativeShareBps" = 10000)
);
CREATE UNIQUE INDEX "ShuttleSettlement_tenantId_billingPeriodId_key" ON "ShuttleSettlement"("tenantId", "billingPeriodId");
ALTER TABLE "ShuttleSettlement" ADD CONSTRAINT "ShuttleSettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShuttleSettlement" ADD CONSTRAINT "ShuttleSettlement_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "ShuttleBillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShuttleSettlementPayment" (
  "settlementId" TEXT NOT NULL, "paymentId" TEXT NOT NULL,
  CONSTRAINT "ShuttleSettlementPayment_pkey" PRIMARY KEY ("settlementId", "paymentId")
);
ALTER TABLE "ShuttleSettlementPayment" ADD CONSTRAINT "ShuttleSettlementPayment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ShuttleSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShuttleSettlementPayment" ADD CONSTRAINT "ShuttleSettlementPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

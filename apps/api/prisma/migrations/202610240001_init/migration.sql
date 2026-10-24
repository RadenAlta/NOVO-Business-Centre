-- Greenfield NOVO schema. Generated-equivalent SQL kept in source for reviewable PostgreSQL migration.
CREATE TYPE "UserRole" AS ENUM ('OWNER','ADMIN','CASHIER','FLEET_MANAGER','CATERING_MANAGER','FINANCE_OFFICER','PROCUREMENT_OFFICER','ANALYST','VIEWER','SUPER_ADMIN','CHAIRMAN','TREASURER','BUSINESS_DEVELOPMENT','ADMIN_STAFF','AUDITOR');
CREATE TYPE "MasterDataType" AS ENUM ('STUDENT','TEACHER','EMPLOYEE');
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED','VOIDED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH','TRANSFER','QRIS','CARD');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE','PAUSED','CANCELLED');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT','ISSUED','PAID','VOID');
CREATE TYPE "CateringStatus" AS ENUM ('DRAFT','CONFIRMED','PREPARING','DELIVERED','CANCELLED');
CREATE TYPE "FinancingStatus" AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED','ACTIVE','CLOSED');
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT','DEBIT');
CREATE TYPE "ProcurementStatus" AS ENUM ('DRAFT','REQUESTED','ORDERED','RECEIVED','CANCELLED');

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE TABLE "CooperativeMember" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "identityId" TEXT, "memberNo" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT, "phone" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CooperativeMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CooperativeMember_tenantId_memberNo_key" ON "CooperativeMember"("tenantId","memberNo");
CREATE INDEX "CooperativeMember_tenantId_name_idx" ON "CooperativeMember"("tenantId","name");
CREATE TABLE "User" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "memberId" TEXT, "email" TEXT NOT NULL, "name" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "role" "UserRole" NOT NULL DEFAULT 'VIEWER', "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId","email");
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId","role");
CREATE TABLE "MasterDataRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "MasterDataType" NOT NULL,
  "identifier" TEXT NOT NULL,
  "barcode" TEXT,
  "fullName" TEXT NOT NULL,
  "className" TEXT,
  "grade" TEXT,
  "schoolYear" TEXT,
  "department" TEXT,
  "position" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "dataSource" TEXT NOT NULL DEFAULT 'MANUAL',
  "externalSimsId" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MasterDataRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MasterDataRecord_tenantId_type_identifier_key" ON "MasterDataRecord"("tenantId","type","identifier");
CREATE INDEX "MasterDataRecord_tenantId_type_active_fullName_idx" ON "MasterDataRecord"("tenantId","type","active","fullName");
CREATE INDEX "MasterDataRecord_tenantId_externalSimsId_idx" ON "MasterDataRecord"("tenantId","externalSimsId");
CREATE UNIQUE INDEX "CooperativeMember_tenantId_identityId_key" ON "CooperativeMember"("tenantId","identityId");
CREATE TABLE "Product" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "sku" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "unitPrice" DECIMAL(14,2) NOT NULL, "reorderLevel" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId","sku");
CREATE INDEX "Product_tenantId_active_idx" ON "Product"("tenantId","active");
CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "productId" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "reason" TEXT NOT NULL, "reference" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockMovement_tenantId_productId_createdAt_idx" ON "StockMovement"("tenantId","productId","createdAt");
CREATE TABLE "Sale" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "cashierId" TEXT NOT NULL, "receiptNo" TEXT NOT NULL, "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED', "paymentMethod" "PaymentMethod" NOT NULL, "total" DECIMAL(14,2) NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sale_tenantId_receiptNo_key" ON "Sale"("tenantId","receiptNo");
CREATE INDEX "Sale_tenantId_occurredAt_idx" ON "Sale"("tenantId","occurredAt");
CREATE TABLE "SaleItem" (
  "id" TEXT NOT NULL, "saleId" TEXT NOT NULL, "productId" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "unitPrice" DECIMAL(14,2) NOT NULL, "subtotal" DECIMAL(14,2) NOT NULL, CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ShuttleRoute" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "stops" JSONB NOT NULL, "monthlyRate" DECIMAL(14,2) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, CONSTRAINT "ShuttleRoute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShuttleRoute_tenantId_code_key" ON "ShuttleRoute"("tenantId","code");
CREATE TABLE "ShuttleSubscription" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "routeId" TEXT NOT NULL, "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE', "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3), CONSTRAINT "ShuttleSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShuttleSubscription_tenantId_status_idx" ON "ShuttleSubscription"("tenantId","status");
CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "subscriptionId" TEXT, "invoiceNo" TEXT NOT NULL, "description" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT', "dueDate" TIMESTAMP(3), "issuedAt" TIMESTAMP(3), CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNo_key" ON "Invoice"("tenantId","invoiceNo");
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId","status");
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "invoiceId" TEXT NOT NULL, "reference" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "method" "PaymentMethod" NOT NULL, "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_tenantId_reference_key" ON "Payment"("tenantId","reference");
CREATE TABLE "Settlement" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "provider" TEXT NOT NULL, "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL, "grossAmount" DECIMAL(14,2) NOT NULL, "feeAmount" DECIMAL(14,2) NOT NULL, "netAmount" DECIMAL(14,2) NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Settlement_tenantId_periodStart_idx" ON "Settlement"("tenantId","periodStart");
CREATE TABLE "SettlementPayment" ("settlementId" TEXT NOT NULL, "paymentId" TEXT NOT NULL, CONSTRAINT "SettlementPayment_pkey" PRIMARY KEY ("settlementId","paymentId"));
CREATE TABLE "CateringOrder" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "memberId" TEXT, "orderNo" TEXT NOT NULL, "customerName" TEXT NOT NULL, "deliveryAt" TIMESTAMP(3) NOT NULL, "items" JSONB NOT NULL, "total" DECIMAL(14,2) NOT NULL, "status" "CateringStatus" NOT NULL DEFAULT 'DRAFT', "notes" TEXT, CONSTRAINT "CateringOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CateringOrder_tenantId_orderNo_key" ON "CateringOrder"("tenantId","orderNo");
CREATE INDEX "CateringOrder_tenantId_deliveryAt_idx" ON "CateringOrder"("tenantId","deliveryAt");
CREATE TABLE "SavingsAccount" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "accountNo" TEXT NOT NULL, "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SavingsAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavingsAccount_tenantId_accountNo_key" ON "SavingsAccount"("tenantId","accountNo");
CREATE UNIQUE INDEX "SavingsAccount_tenantId_memberId_key" ON "SavingsAccount"("tenantId","memberId");
CREATE TABLE "SavingsLedgerEntry" (
  "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "direction" "LedgerDirection" NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "reference" TEXT NOT NULL, "description" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SavingsLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavingsLedgerEntry_accountId_reference_key" ON "SavingsLedgerEntry"("accountId","reference");
CREATE INDEX "SavingsLedgerEntry_accountId_occurredAt_idx" ON "SavingsLedgerEntry"("accountId","occurredAt");
CREATE TABLE "FinancingApplication" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "applicationNo" TEXT NOT NULL, "purpose" TEXT NOT NULL, "principal" DECIMAL(14,2) NOT NULL, "outstanding" DECIMAL(14,2) NOT NULL, "status" "FinancingStatus" NOT NULL DEFAULT 'DRAFT', "submittedAt" TIMESTAMP(3), "approvedAt" TIMESTAMP(3), CONSTRAINT "FinancingApplication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinancingApplication_tenantId_applicationNo_key" ON "FinancingApplication"("tenantId","applicationNo");
CREATE INDEX "FinancingApplication_tenantId_status_idx" ON "FinancingApplication"("tenantId","status");
CREATE TABLE "Receivable" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "installmentNo" INTEGER NOT NULL, "dueDate" TIMESTAMP(3) NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0, CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Receivable_applicationId_installmentNo_key" ON "Receivable"("applicationId","installmentNo");
CREATE TABLE "ProcurementRequest" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "requestNo" TEXT NOT NULL, "supplier" TEXT, "description" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "status" "ProcurementStatus" NOT NULL DEFAULT 'DRAFT', "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProcurementRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProcurementRequest_tenantId_requestNo_key" ON "ProcurementRequest"("tenantId","requestNo");
CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "uploadedById" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "filename" TEXT NOT NULL, "contentType" TEXT NOT NULL, "size" INTEGER NOT NULL, "storageKey" TEXT NOT NULL, "sha256" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Attachment_tenantId_entityType_entityId_idx" ON "Attachment"("tenantId","entityType","entityId");
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "actorId" TEXT, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "before" JSONB, "after" JSONB, "ip" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_tenantId_entityType_entityId_createdAt_idx" ON "AuditLog"("tenantId","entityType","entityId","createdAt");
CREATE TABLE "AiInteraction" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT, "feature" TEXT NOT NULL, "prompt" TEXT NOT NULL, "response" TEXT NOT NULL, "model" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiInteraction_tenantId_feature_createdAt_idx" ON "AiInteraction"("tenantId","feature","createdAt");
CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "title" TEXT NOT NULL, "content" TEXT NOT NULL, "source" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KnowledgeDocument_tenantId_title_idx" ON "KnowledgeDocument"("tenantId","title");

ALTER TABLE "CooperativeMember" ADD CONSTRAINT "CooperativeMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasterDataRecord" ADD CONSTRAINT "MasterDataRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CooperativeMember" ADD CONSTRAINT "CooperativeMember_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "MasterDataRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CooperativeMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShuttleRoute" ADD CONSTRAINT "ShuttleRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShuttleSubscription" ADD CONSTRAINT "ShuttleSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShuttleSubscription" ADD CONSTRAINT "ShuttleSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CooperativeMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShuttleSubscription" ADD CONSTRAINT "ShuttleSubscription_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ShuttleRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ShuttleSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementPayment" ADD CONSTRAINT "SettlementPayment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementPayment" ADD CONSTRAINT "SettlementPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CateringOrder" ADD CONSTRAINT "CateringOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CateringOrder" ADD CONSTRAINT "CateringOrder_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CooperativeMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavingsAccount" ADD CONSTRAINT "SavingsAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavingsAccount" ADD CONSTRAINT "SavingsAccount_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CooperativeMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SavingsLedgerEntry" ADD CONSTRAINT "SavingsLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SavingsAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancingApplication" ADD CONSTRAINT "FinancingApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancingApplication" ADD CONSTRAINT "FinancingApplication_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CooperativeMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FinancingApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementRequest" ADD CONSTRAINT "ProcurementRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

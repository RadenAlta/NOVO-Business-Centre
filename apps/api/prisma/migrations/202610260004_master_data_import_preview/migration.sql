CREATE TABLE "MasterDataImportPreview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MasterDataImportPreview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MasterDataImportPreview_tenantId_createdById_expiresAt_idx" ON "MasterDataImportPreview"("tenantId", "createdById", "expiresAt");
CREATE INDEX "MasterDataImportPreview_expiresAt_idx" ON "MasterDataImportPreview"("expiresAt");

ALTER TABLE "MasterDataImportPreview" ADD CONSTRAINT "MasterDataImportPreview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasterDataImportPreview" ADD CONSTRAINT "MasterDataImportPreview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
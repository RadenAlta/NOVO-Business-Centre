-- Shuttle A1 subscription foundation only. Financial lifecycle DDL belongs to A2.
ALTER TABLE "ShuttleSubscription" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "ShuttleSubscription" ADD COLUMN "studentIdentityId" TEXT,
ADD COLUMN "effectiveMonthlyRate" DECIMAL(14,2),
ADD COLUMN "payerName" TEXT,
ADD COLUMN "payerContact" TEXT;
ALTER TABLE "ShuttleSubscription" ADD CONSTRAINT "ShuttleSubscription_studentIdentityId_fkey" FOREIGN KEY ("studentIdentityId") REFERENCES "MasterDataRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

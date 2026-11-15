-- One active Shuttle subscription is permitted for each tenant, route, and rider.
-- Historical rows are intentionally preserved: CANCELLED and PAUSED subscriptions
-- do not participate, so a corrected rider can subscribe again after cancellation.
-- Prisma schema cannot express PostgreSQL partial unique indexes.
CREATE UNIQUE INDEX "ShuttleSubscription_active_member_unique_idx"
ON "ShuttleSubscription" ("tenantId", "routeId", "memberId")
WHERE "status" = 'ACTIVE'
  AND "memberId" IS NOT NULL;

CREATE UNIQUE INDEX "ShuttleSubscription_active_student_unique_idx"
ON "ShuttleSubscription" ("tenantId", "routeId", "studentIdentityId")
WHERE "status" = 'ACTIVE'
  AND "studentIdentityId" IS NOT NULL;

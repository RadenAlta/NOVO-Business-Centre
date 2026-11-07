-- Each Shuttle subscription has exactly one rider; the API validates the same XOR.
ALTER TABLE "ShuttleSubscription"
ADD CONSTRAINT "ShuttleSubscription_exactly_one_rider_check"
CHECK ((("memberId" IS NOT NULL)::int + ("studentIdentityId" IS NOT NULL)::int) = 1);

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

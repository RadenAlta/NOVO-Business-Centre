import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isActiveShuttleSubscriptionUniqueConflict } from "./shuttle-subscription-unique.js";

function p2002(target: unknown, message = "Unique constraint failed"): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    message,
    { code: "P2002", clientVersion: "6.19.3", meta: { target } },
  );
}

describe("active Shuttle subscription P2002 mapping", () => {
  it.each([
    "ShuttleSubscription_active_member_unique_idx",
    "ShuttleSubscription_active_student_unique_idx",
  ])("recognizes %s", (target) => {
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(target))).toBe(true);
  });

  it("recognizes a supported single-element index-name array", () => {
    expect(
      isActiveShuttleSubscriptionUniqueConflict(
        p2002(["ShuttleSubscription_active_member_unique_idx"]),
      ),
    ).toBe(true);
  });

  it.each([
    ["member", ["tenantId", "routeId", "memberId"]],
    ["student", ["tenantId", "routeId", "studentIdentityId"]],
  ])("recognizes the complete %s field tuple", (_kind, target) => {
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(target))).toBe(true);
  });

  it("recognizes an exact index name reported only in the database message", () => {
    expect(
      isActiveShuttleSubscriptionUniqueConflict(
        p2002([], 'duplicate key violates unique constraint "ShuttleSubscription_active_member_unique_idx"'),
      ),
    ).toBe(true);
  });

  it("does not change generic duplicate handling for other unique constraints", () => {
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002("Product_tenantId_sku_key"))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(["tenantId", "routeId"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(["tenantId", "routeId", "memberId", "id"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(["tenantId", "routeId", "memberId", "memberId"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(["memberId"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002(["ShuttleSubscription_active_member_unique_idx", "unrelated"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002("prefix ShuttleSubscription_active_member_unique_idx"))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002("xShuttleSubscription_active_member_unique_idxSuffix"))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002([], 'duplicate key violates unique constraint "xShuttleSubscription_active_member_unique_idx"'))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict({ code: "P2034" })).toBe(false);
  });
});

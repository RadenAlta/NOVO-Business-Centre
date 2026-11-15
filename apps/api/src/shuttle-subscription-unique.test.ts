import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isActiveShuttleSubscriptionUniqueConflict } from "./shuttle-subscription-unique.js";

function p2002(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on ${target}`,
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

  it("does not change generic duplicate handling for other unique constraints", () => {
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002("Product_tenantId_sku_key"))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict({ code: "P2034" })).toBe(false);
  });
});

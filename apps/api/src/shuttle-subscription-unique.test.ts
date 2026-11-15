import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isActiveShuttleSubscriptionUniqueConflict } from "./shuttle-subscription-unique.js";

function p2002(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on ${target}`,
    { code: "P2002", clientVersion: "6.19.3", meta: { target } },
  );
}

function p2002Target(target: unknown, message = "Unique constraint failed"): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, { code: "P2002", clientVersion: "6.19.3", meta: { target } });
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

  it("accepts only an exact approved PostgreSQL target and rejects mixed metadata", () => {
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target(["tenantId", "routeId", "memberId"]))).toBe(true);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target(["tenantId", "routeId", "studentIdentityId"]))).toBe(true);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target(["ShuttleSubscription_active_member_unique_idx"]))).toBe(true);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target(["tenantId", "routeId", "memberId", "memberId"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target(["ShuttleSubscription_active_member_unique_idx", "other_index"]))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target(["tenantId", "routeId", "otherId"]))).toBe(false);
  });

  it("matches a complete PostgreSQL index identifier but not a prefix or suffix", () => {
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target("other", 'duplicate key value violates unique constraint "ShuttleSubscription_active_member_unique_idx"'))).toBe(true);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target("other", 'constraint "ShuttleSubscription_active_member_unique_idx_backup"'))).toBe(false);
    expect(isActiveShuttleSubscriptionUniqueConflict(p2002Target("other", 'constraint "prefix_ShuttleSubscription_active_member_unique_idx"'))).toBe(false);
  });
});

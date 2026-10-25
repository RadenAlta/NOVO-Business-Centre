import { describe, expect, it } from "vitest";
import { API_PREFIX, userRoles } from "./index.js";

describe("shared NOVO contracts", () => {
  it("exposes the versioned API prefix used by API clients", () => {
    expect(API_PREFIX).toBe("/api/v1");
  });

  it("keeps the supported cooperative operator roles complete and unique", () => {
    expect(userRoles).toEqual([
      "OWNER",
      "ADMIN",
      "CASHIER",
      "FLEET_MANAGER",
      "CATERING_MANAGER",
      "FINANCE_OFFICER",
      "PROCUREMENT_OFFICER",
      "ANALYST",
      "VIEWER",
    ]);
    expect(new Set(userRoles).size).toBe(userRoles.length);
  });

  it("does not treat a student identity as a cooperative operator role", () => {
    expect(userRoles).not.toContain("STUDENT");
  });
});

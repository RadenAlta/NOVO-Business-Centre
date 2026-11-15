import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { activityClassificationErrorMessage, canUseActivityClassification, manualActivityDraft } from "./activity-classification";

describe("activity-classification view model", () => {
  it("mirrors delegated server roles for suggestion access without treating the UI as the authorization boundary", () => {
    expect(canUseActivityClassification("ANALYST")).toBe(true);
    expect(canUseActivityClassification("SUPER_ADMIN")).toBe(true);
    expect(canUseActivityClassification("CASHIER")).toBe(false);
  });

  it("keeps a manual correction as an explicitly non-persistent draft", () => {
    expect(manualActivityDraft("SERVICE")).toEqual({ category: "SERVICE", source: "MANUAL_DRAFT", persisted: false });
  });

  it("gives a safe manual fallback when the provider is unavailable", () => {
    expect(activityClassificationErrorMessage(new ApiError(503, "internal host unavailable", "ML_SERVICE_UNAVAILABLE"))).toContain("Pilih kategori secara manual");
    expect(activityClassificationErrorMessage(new ApiError(500, "internal host unavailable"))).not.toContain("internal host unavailable");
  });
});

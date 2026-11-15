import { describe, expect, it } from "vitest";
import { inclusiveActiveDays, jakartaMonth, proratedRupiah, shuttleRupiahBigInt, shuttleRupiahNumber, sumShuttleRupiah } from "./shuttle-billing.js";

describe("Shuttle billing calendar and proration", () => {
  it("uses a stable Jakarta calendar boundary across a year transition", () => {
    const period = jakartaMonth(2026, 12);
    expect(period.startsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(period.endsAt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(period.days).toBe(31);
  });
  it("counts only inclusive active days overlapping a period", () => {
    const period = jakartaMonth(2026, 2);
    expect(inclusiveActiveDays({ startDate: new Date("2026-02-10T00:00:00.000Z"), endDate: new Date("2026-02-14T00:00:00.000Z") }, period.startsAt, period.endsAt)).toBe(5);
  });
  it("rounds proration deterministically with integer Rupiah arithmetic", () => {
    expect(proratedRupiah(100_000, 15, 30)).toBe(50_000);
    expect(proratedRupiah(100, 1, 6)).toBe(17);
  });

  it("accepts only whole, safe Rupiah values for persisted Shuttle calculations", () => {
    expect(shuttleRupiahBigInt("100000")).toBe(100_000n);
    expect(sumShuttleRupiah(["60000", "40000"])).toBe(100_000n);
    expect(shuttleRupiahNumber(100_000n)).toBe(100_000);
    expect(() => shuttleRupiahBigInt("100000.50")).toThrow("whole Rupiah");
    expect(() => shuttleRupiahBigInt("NaN")).toThrow("whole Rupiah");
    expect(() => shuttleRupiahBigInt(Number.POSITIVE_INFINITY)).toThrow("whole Rupiah");
    expect(() => shuttleRupiahBigInt(9_007_199_254_740_992n)).toThrow("outside the supported");
    expect(() => shuttleRupiahBigInt("1000000000")).toThrow("outside the supported");
  });
});

import { describe, expect, it } from "vitest";
import { inclusiveActiveDays, jakartaMonth, jakartaPeriodDays, jakartaPeriodLabel, proratedRupiah, shuttleRupiahBigInt, shuttleRupiahNumber, sumShuttleRupiah } from "./shuttle-billing.js";

describe("Shuttle billing calendar and whole-Rupiah arithmetic", () => {
  it("uses Jakarta local-midnight boundaries across a year transition", () => {
    const period = jakartaMonth(2026, 12);
    expect(period.startsAt.toISOString()).toBe("2026-11-30T17:00:00.000Z");
    expect(period.endsAt.toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(period.days).toBe(31);
    expect(jakartaPeriodDays(period.startsAt, period.endsAt)).toBe(31);
    expect(jakartaPeriodLabel(period.startsAt)).toBe("2026-12");
    const leapFebruary = jakartaMonth(2028, 2);
    expect(jakartaPeriodDays(leapFebruary.startsAt, leapFebruary.endsAt)).toBe(29);
    expect(jakartaPeriodLabel(leapFebruary.startsAt)).toBe("2028-02");
  });

  it("counts inclusive Jakarta calendar dates at both period cutoffs", () => {
    const february = jakartaMonth(2026, 2);
    expect(inclusiveActiveDays({ startDate: new Date("2026-02-10T00:00:00.000Z"), endDate: new Date("2026-02-14T00:00:00.000Z") }, february.startsAt, february.endsAt)).toBe(5);
    expect(inclusiveActiveDays({ startDate: new Date("2026-01-31T00:00:00.000Z"), endDate: new Date("2026-02-01T00:00:00.000Z") }, february.startsAt, february.endsAt)).toBe(1);
    expect(inclusiveActiveDays({ startDate: new Date("2026-03-01T00:00:00.000Z"), endDate: null }, february.startsAt, february.endsAt)).toBe(0);
  });

  it("rounds proration deterministically with integer Rupiah arithmetic", () => {
    expect(proratedRupiah(100_000, 15, 30)).toBe(50_000);
    expect(proratedRupiah(100, 1, 6)).toBe(17);
  });

  it("accepts only whole, safe persisted Rupiah values", () => {
    expect(shuttleRupiahBigInt("100000")).toBe(100_000n);
    expect(sumShuttleRupiah(["60000", "40000"])).toBe(100_000n);
    expect(shuttleRupiahNumber(100_000n)).toBe(100_000);
    expect(() => shuttleRupiahBigInt("100000.50")).toThrow("whole Rupiah");
    expect(() => shuttleRupiahBigInt("NaN")).toThrow("whole Rupiah");
    expect(() => shuttleRupiahBigInt(Number.POSITIVE_INFINITY)).toThrow("whole Rupiah");
    expect(() => shuttleRupiahBigInt(1_000_000_000n)).toThrow("outside the supported");
  });
});

import { describe, expect, it } from "vitest";
import { asNumber, makeReference } from "./lib.js";

describe("domain helpers", () => {
  it("converts Prisma-like decimals without precision-string coercion", () => {
    expect(asNumber({ toString: () => "12500.50" })).toBe(12500.5);
  });

  it("creates non-repeating business references", () => {
    const first = makeReference("POS");
    const second = makeReference("POS");
    expect(first).toMatch(/^POS-\d{8}-[A-Z0-9-]+$/);
    expect(first).not.toEqual(second);
  });
});

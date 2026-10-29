import { describe, expect, it } from "vitest";

import {
  normalizeStoreSku,
  storeSkuInput,
  storeSkuPattern,
} from "./store-sku.js";

describe("Store SKU canonical form", () => {
  it("canonicalizes valid ASCII input to uppercase", () => {
    expect(storeSkuInput.parse("abc-001")).toBe("ABC-001");
    expect(storeSkuInput.parse("ABC-001")).toBe("ABC-001");
    expect(storeSkuInput.parse("ab")).toBe("AB");
    expect(storeSkuInput.parse("A".repeat(50))).toBe("A".repeat(50));
    expect(storeSkuInput.parse("a.b_c/d-e")).toBe("A.B_C/D-E");
  });

  it.each([
    " ABC-001",
    "ABC-001 ",
    " ABC-001 ",
    "\tABC-001",
    "ABC-001\n",
    "\u00A0ABC-001",
    "ABC 001",
    "SKU-Ä",
    "ＡＢＣ-001",
    "A",
    "",
    "A".repeat(51),
    "A\u200B1",
  ])("rejects noncanonical raw input %j", (value) => {
    expect(storeSkuInput.safeParse(value).success).toBe(false);
  });

  it("never silently trims during canonicalization", () => {
    expect(normalizeStoreSku("abc-001")).toBe("ABC-001");
    expect(normalizeStoreSku(" abc-001 ")).toBe(" ABC-001 ");
  });

  it("retains the same ASCII alphabet and length limits", () => {
    expect(storeSkuPattern.test("AB")).toBe(true);
    expect(storeSkuPattern.test("A")).toBe(false);
    expect(storeSkuPattern.test("SKU WITH SPACE")).toBe(false);
    expect(storeSkuPattern.test("SKU-Ä")).toBe(false);
  });
});
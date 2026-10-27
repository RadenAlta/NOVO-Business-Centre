import { describe, expect, it } from "vitest";

import { normalizeStoreSku, storeSkuPattern } from "./store-sku.js";

describe("Store SKU canonical form", () => {
  it("uses an ASCII-only canonical uppercase form shared with the PostgreSQL migration", () => {
    expect(normalizeStoreSku(" abc-001 ")).toBe("ABC-001");
    expect(storeSkuPattern.test("abc-001")).toBe(true);
    expect(storeSkuPattern.test("A")).toBe(false);
    expect(storeSkuPattern.test("SKU WITH SPACE")).toBe(false);
    expect(storeSkuPattern.test("SKU-Ä")).toBe(false);
  });
});
import { describe, expect, it } from "vitest";

import {
  fingerprintInventoryMutation,
  inventoryIdempotencyKeySchema,
} from "./store-inventory-idempotency.js";

const receipt = {
  operation: "STOCK_RECEIPT" as const,
  productId: "product-001",
  quantity: 10,
  reference: "DOC-2026-001",
};

const adjustment = {
  operation: "STOCK_ADJUSTMENT" as const,
  productId: "product-001",
  quantity: -2,
  reason: "Physical inventory count",
  reference: "STOCK-COUNT-001",
};

describe("Inventory idempotency foundation", () => {
  it("accepts a valid idempotency key", () => {
    expect(
      inventoryIdempotencyKeySchema.parse("inventory-receipt-001"),
    ).toBe("inventory-receipt-001");
  });

  it("rejects malformed and short idempotency keys", () => {
    for (const key of ["short", "invalid key", "éabcdefg", ""]) {
      expect(
        inventoryIdempotencyKeySchema.safeParse(key).success,
      ).toBe(false);
    }
  });

  it("produces a stable fingerprint for identical requests", () => {
    expect(fingerprintInventoryMutation({ ...receipt })).toBe(
      fingerprintInventoryMutation({ ...receipt }),
    );
  });

  it("separates receipts from stock adjustments", () => {
    expect(fingerprintInventoryMutation(receipt)).not.toBe(
      fingerprintInventoryMutation({
        ...adjustment,
        quantity: receipt.quantity,
        reference: receipt.reference,
      }),
    );
  });

  it("distinguishes different products", () => {
    expect(fingerprintInventoryMutation(receipt)).not.toBe(
      fingerprintInventoryMutation({
        ...receipt,
        productId: "product-002",
      }),
    );
  });

  it("distinguishes different stock quantities", () => {
    expect(fingerprintInventoryMutation(receipt)).not.toBe(
      fingerprintInventoryMutation({
        ...receipt,
        quantity: 11,
      }),
    );
  });

  it("distinguishes business reference changes", () => {
    expect(fingerprintInventoryMutation(receipt)).not.toBe(
      fingerprintInventoryMutation({
        ...receipt,
        reference: "DOC-2026-002",
      }),
    );
  });

  it("distinguishes stock adjustment reasons", () => {
    expect(fingerprintInventoryMutation(adjustment)).not.toBe(
      fingerprintInventoryMutation({
        ...adjustment,
        reason: "Damaged goods",
      }),
    );
  });

  it("distinguishes unchanged, cleared, and updated HPP", () => {
    const unchanged = fingerprintInventoryMutation(receipt);
    const cleared = fingerprintInventoryMutation({
      ...receipt,
      unitCost: null,
    });
    const updated = fingerprintInventoryMutation({
      ...receipt,
      unitCost: 2500,
    });

    expect(unchanged).not.toBe(cleared);
    expect(unchanged).not.toBe(updated);
    expect(cleared).not.toBe(updated);
  });

  it("distinguishes different HPP values", () => {
    expect(
      fingerprintInventoryMutation({ ...receipt, unitCost: 2500 }),
    ).not.toBe(
      fingerprintInventoryMutation({ ...receipt, unitCost: 2600 }),
    );
  });

  it("returns a lowercase SHA-256 hexadecimal fingerprint", () => {
    expect(fingerprintInventoryMutation(receipt)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

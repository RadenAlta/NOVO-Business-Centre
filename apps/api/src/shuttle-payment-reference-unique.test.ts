import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isPaymentReferenceUniqueConflict } from "./shuttle-payment-reference-unique.js";

function p2002(target: unknown, message = "Unique constraint failed"): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target },
  });
}

describe("Shuttle payment replay P2002 mapping", () => {
  it("recognizes only the exact tenant reference constraint", () => {
    expect(isPaymentReferenceUniqueConflict(p2002(["tenantId", "reference"]))).toBe(true);
    expect(isPaymentReferenceUniqueConflict(p2002("Payment_tenantId_reference_key"))).toBe(true);
    expect(isPaymentReferenceUniqueConflict(p2002(["Payment_tenantId_reference_key"]))).toBe(false);
  });

  it("rejects unrelated, duplicated, and prefix or suffix targets", () => {
    expect(isPaymentReferenceUniqueConflict(p2002(["tenantId", "reference", "invoiceId"]))).toBe(false);
    expect(isPaymentReferenceUniqueConflict(p2002(["tenantId", "tenantId"]))).toBe(false);
    expect(isPaymentReferenceUniqueConflict(p2002("Invoice_tenantId_invoiceNo_key"))).toBe(false);
    expect(isPaymentReferenceUniqueConflict(p2002("other", 'constraint "Payment_tenantId_reference_key_backup"'))).toBe(false);
  });
});

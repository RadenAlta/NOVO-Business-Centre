import { describe, expect, it } from "vitest";

import {
  hasRole,
  invoiceOutstanding,
  isProtectedResourceQueryKey,
  paymentProofPreflight,
  shuttleErrorMessage,
  shuttleFinanceRoles,
  shuttleInvoiceReadRoles,
  shuttlePaymentRecordRoles,
} from "./shuttle-ui";
import { ApiError } from "./api";

describe("Shuttle view-model safeguards", () => {
  it("derives outstanding balance from verified payments only", () => {
    expect(
      invoiceOutstanding(100_000, [
        { amount: 25_000, status: "VERIFIED" },
        { amount: 25_000, status: "RECORDED" },
        { amount: 10_000, status: "REVERSED" },
      ]),
    ).toBe(75_000);
  });

  it("never renders a negative balance after an unexpected duplicate record", () => {
    expect(
      invoiceOutstanding(100_000, [{ amount: 150_000, status: "VERIFIED" }]),
    ).toBe(0);
  });

  it("presents authorization and financial-conflict errors without internal detail", () => {
    expect(shuttleErrorMessage(new ApiError(403, "forbidden"))).toContain(
      "Akses ditolak",
    );
    expect(
      shuttleErrorMessage(
        new ApiError(409, "conflict", "PAYMENT_ALLOCATED_TO_SETTLEMENT"),
      ),
    ).toContain("PAYMENT_ALLOCATED_TO_SETTLEMENT");
    expect(
      shuttleErrorMessage(new ApiError(500, "database host path")),
    ).not.toContain("database host path");
  });

  it("matches each scoped Shuttle query when a related mutation invalidates it", () => {
    expect(
      isProtectedResourceQueryKey(
        [
          "novo-protected",
          "shuttle-routes:/shuttle/routes?page=1",
          "tenant",
          "user",
        ],
        "shuttle-routes",
      ),
    ).toBe(true);
    expect(
      isProtectedResourceQueryKey(
        ["novo-protected", "products", "tenant", "user"],
        "shuttle-routes",
      ),
    ).toBe(false);
  });

  it("keeps finance-only actions hidden from an unprivileged role", () => {
    expect(hasRole("VIEWER", shuttleFinanceRoles)).toBe(false);
    expect(hasRole("ADMIN", shuttleFinanceRoles)).toBe(true);
    expect(hasRole("SUPER_ADMIN", shuttleInvoiceReadRoles)).toBe(true);
    expect(hasRole("TREASURER", shuttleInvoiceReadRoles)).toBe(true);
    expect(hasRole("CASHIER", shuttlePaymentRecordRoles)).toBe(true);
    expect(hasRole("CASHIER", shuttleInvoiceReadRoles)).toBe(false);
  });

  it("rejects an unsupported or oversized proof before upload while preserving server signature validation", () => {
    expect(paymentProofPreflight({ type: "text/plain", size: 20 })).toContain(
      "PDF",
    );
    expect(
      paymentProofPreflight({
        type: "application/pdf",
        size: 5 * 1024 * 1024 + 1,
      }),
    ).toContain("5 MiB");
    expect(
      paymentProofPreflight({ type: "image/png", size: 5 * 1024 * 1024 }),
    ).toBeUndefined();
  });
});

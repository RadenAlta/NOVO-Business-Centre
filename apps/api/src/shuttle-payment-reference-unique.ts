const paymentReferenceIndex = "Payment_tenantId_reference_key";
const paymentReferenceFields = ["tenantId", "reference"] as const;

function hasExactPaymentReferenceTarget(target: unknown): boolean {
  if (target === paymentReferenceIndex) return true;
  if (!Array.isArray(target) || target.length !== paymentReferenceFields.length) {
    return false;
  }
  return target.every(
    (field) => typeof field === "string" && paymentReferenceFields.includes(field as (typeof paymentReferenceFields)[number]),
  ) && new Set(target).size === paymentReferenceFields.length;
}

function hasExactPaymentReferenceMessage(message: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${paymentReferenceIndex}(?![A-Za-z0-9_])`).test(message);
}

/** Identifies only the tenant-scoped Payment reference unique constraint. */
export function isPaymentReferenceUniqueConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    !error ||
    !("code" in error) ||
    (error as { code?: string }).code !== "P2002"
  ) {
    return false;
  }
  const target =
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta &&
    "target" in error.meta
      ? error.meta.target
      : undefined;
  return hasExactPaymentReferenceTarget(target) ||
    hasExactPaymentReferenceMessage(error instanceof Error ? error.message : "");
}

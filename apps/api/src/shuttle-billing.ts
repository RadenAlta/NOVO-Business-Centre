import { HttpError } from "./lib.js";

/**
 * Provisional Capstone policy: Shuttle financial values are whole Indonesian
 * Rupiah. Keep the limit comfortably below both the Prisma Decimal(14,2)
 * ceiling and JavaScript's safe-integer ceiling.
 */
export const MAX_SHUTTLE_RUPIAH = 999_999_999;

type DecimalLike = { toString(): string } | number | bigint;

/** Rejects fractional, non-finite, negative, and unsafe persisted values. */
export function shuttleRupiahBigInt(value: DecimalLike, code = "INVALID_SHUTTLE_AMOUNT"): bigint {
  const raw = typeof value === "bigint" ? value.toString() : typeof value === "number" ? String(value) : value.toString();
  const normalized = raw.replace(/\.0+$/, "");
  if (!/^-?\d+$/.test(normalized)) {
    throw new HttpError(409, code, "Shuttle financial records must use whole Rupiah values.");
  }
  const amount = BigInt(normalized);
  if (amount < 0n || amount > BigInt(MAX_SHUTTLE_RUPIAH)) {
    throw new HttpError(409, code, "Shuttle financial amount is outside the supported Rupiah range.");
  }
  return amount;
}

export function shuttleRupiahNumber(value: bigint, code = "INVALID_SHUTTLE_AMOUNT"): number {
  if (value < 0n || value > BigInt(MAX_SHUTTLE_RUPIAH)) {
    throw new HttpError(409, code, "Shuttle financial amount is outside the supported Rupiah range.");
  }
  return Number(value);
}

export function sumShuttleRupiah(values: Iterable<DecimalLike>, code = "INVALID_SHUTTLE_AMOUNT"): bigint {
  let total = 0n;
  for (const value of values) {
    total += shuttleRupiahBigInt(value, code);
    if (total > BigInt(MAX_SHUTTLE_RUPIAH)) {
      throw new HttpError(409, code, "Shuttle financial total is outside the supported Rupiah range.");
    }
  }
  return total;
}

/** A billing month is represented as [startsAt, endsAt) in Asia/Jakarta calendar terms. */
export function jakartaMonth(year: number, month: number) {
  const startsAt = new Date(Date.UTC(year, month - 1, 1));
  return { startsAt, endsAt: new Date(Date.UTC(year, month, 1)), days: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

/** Subscription end dates are inclusive; billing-period ends are exclusive. */
export function inclusiveActiveDays(subscription: { startDate: Date; endDate: Date | null }, startsAt: Date, endsAt: Date): number {
  const start = Math.max(subscription.startDate.getTime(), startsAt.getTime());
  const endInclusive = Math.min((subscription.endDate ? subscription.endDate.getTime() + 86_400_000 : endsAt.getTime()), endsAt.getTime());
  return Math.max(0, Math.round((endInclusive - start) / 86_400_000));
}

/** Deterministic half-up proration using integer arithmetic only. */
export function proratedRupiah(rate: number, activeDays: number, periodDays: number): number {
  if (!Number.isSafeInteger(rate) || activeDays < 0 || periodDays < 1) throw new HttpError(400, "INVALID_EFFECTIVE_RATE", "The effective Shuttle rate must be an integer Rupiah value.");
  return Number((BigInt(rate) * BigInt(activeDays) + BigInt(Math.floor(periodDays / 2))) / BigInt(periodDays));
}

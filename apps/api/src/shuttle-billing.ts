import { HttpError } from "./lib.js";

/** Provisional Capstone contract: Shuttle money is whole Rupiah only. */
export const MAX_SHUTTLE_RUPIAH = 999_999_999;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;

type DecimalLike = { toString(): string } | number | bigint;

export function shuttleRupiahBigInt(value: DecimalLike, code = "INVALID_SHUTTLE_AMOUNT"): bigint {
  const raw = typeof value === "bigint" ? value.toString() : typeof value === "number" ? String(value) : value.toString();
  const normalized = raw.replace(/\.0+$/, "");
  if (!/^-?\d+$/.test(normalized)) throw new HttpError(409, code, "Shuttle financial records must use whole Rupiah values.");
  const amount = BigInt(normalized);
  if (amount < 0n || amount > BigInt(MAX_SHUTTLE_RUPIAH)) throw new HttpError(409, code, "Shuttle financial amount is outside the supported Rupiah range.");
  return amount;
}

export function shuttleRupiahNumber(value: bigint, code = "INVALID_SHUTTLE_AMOUNT"): number {
  if (value < 0n || value > BigInt(MAX_SHUTTLE_RUPIAH)) throw new HttpError(409, code, "Shuttle financial amount is outside the supported Rupiah range.");
  return Number(value);
}

export function sumShuttleRupiah(values: Iterable<DecimalLike>, code = "INVALID_SHUTTLE_AMOUNT"): bigint {
  let total = 0n;
  for (const value of values) {
    total += shuttleRupiahBigInt(value, code);
    if (total > BigInt(MAX_SHUTTLE_RUPIAH)) throw new HttpError(409, code, "Shuttle financial total is outside the supported Rupiah range.");
  }
  return total;
}

/** A Jakarta calendar month is [local midnight, next local midnight), stored in UTC. */
export function jakartaMonth(year: number, month: number) {
  const startsAt = new Date(Date.UTC(year, month - 1, 1) - JAKARTA_OFFSET_MS);
  const endsAt = new Date(Date.UTC(year, month, 1) - JAKARTA_OFFSET_MS);
  return { startsAt, endsAt, days: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

/** The stored Jakarta interval has no DST transition, so its elapsed days are calendar days. */
export function jakartaPeriodDays(startsAt: Date, endsAt: Date): number {
  const elapsed = endsAt.getTime() - startsAt.getTime();
  const days = elapsed / 86_400_000;
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    throw new HttpError(409, "INVALID_BILLING_PERIOD", "The Shuttle billing period is not a valid Jakarta calendar month.");
  }
  return days;
}

/** Stable YYYY-MM label for a stored Jakarta local-midnight period boundary. */
export function jakartaPeriodLabel(startsAt: Date): string {
  const local = new Date(startsAt.getTime() + JAKARTA_OFFSET_MS);
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${local.getUTCFullYear()}-${month}`;
}

function jakartaCalendarStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - JAKARTA_OFFSET_MS);
}

/** Subscription end dates are inclusive calendar dates; period end is exclusive. */
export function inclusiveActiveDays(subscription: { startDate: Date; endDate: Date | null }, startsAt: Date, endsAt: Date): number {
  const start = Math.max(jakartaCalendarStart(subscription.startDate).getTime(), startsAt.getTime());
  const subscriptionEnd = subscription.endDate === null ? endsAt.getTime() : jakartaCalendarStart(subscription.endDate).getTime() + 86_400_000;
  const end = Math.min(subscriptionEnd, endsAt.getTime());
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Deterministic half-up proration using integer arithmetic only. */
export function proratedRupiah(rate: number, activeDays: number, periodDays: number): number {
  if (!Number.isSafeInteger(rate) || rate < 1 || activeDays < 0 || !Number.isInteger(activeDays) || periodDays < 1 || !Number.isInteger(periodDays)) throw new HttpError(400, "INVALID_EFFECTIVE_RATE", "The effective Shuttle rate must be an integer Rupiah value.");
  return Number((BigInt(rate) * BigInt(activeDays) + BigInt(Math.floor(periodDays / 2))) / BigInt(periodDays));
}

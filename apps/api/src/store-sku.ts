import { z } from "zod";

/**
 * SKU storage is deliberately ASCII-only. With this alphabet, JavaScript
 * uppercasing and PostgreSQL UPPER() have identical canonical semantics.
 */
export const storeSkuPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$/;

export function normalizeStoreSku(value: string): string {
  return value.toUpperCase();
}

export const storeSkuInput = z.string()
  .regex(
    storeSkuPattern,
    "SKU must use 2–50 ASCII letters, digits, dots, underscores, slashes, or hyphens.",
  )
  .transform(normalizeStoreSku);
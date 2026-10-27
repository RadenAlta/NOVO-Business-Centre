/**
 * SKU storage is deliberately ASCII-only. With this alphabet, JavaScript
 * uppercasing and PostgreSQL UPPER() have identical canonical semantics.
 */
export const storeSkuPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$/;

export function normalizeStoreSku(value: string): string {
  return value.trim().toUpperCase();
}
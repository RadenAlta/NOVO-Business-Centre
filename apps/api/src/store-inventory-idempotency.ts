import { createHash } from "node:crypto";
import { z } from "zod";

export const inventoryIdempotencyKeySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
    "Idempotency-Key must contain 8-128 permitted ASCII characters.",
  );

type InventoryMutationBase = {
  productId: string;
  quantity: number;
  reference?: string;
};

export type InventoryMutationFingerprintInput =
  | (InventoryMutationBase & {
      operation: "STOCK_RECEIPT";
      unitCost?: number | null;
    })
  | (InventoryMutationBase & {
      operation: "STOCK_ADJUSTMENT";
      reason: string;
    });

/**
 * Canonical hash of the business operation.
 *
 * The database will scope idempotency keys by tenant.
 * Operation and productId prevent cross-operation key reuse.
 * The business reference is not itself an idempotency key.
 */
export function fingerprintInventoryMutation(
  input: InventoryMutationFingerprintInput,
): string {
  const canonical =
    input.operation === "STOCK_RECEIPT"
      ? {
          operation: input.operation,
          productId: input.productId,
          quantity: input.quantity,
          reference: input.reference ?? null,
          costAction:
            input.unitCost === undefined
              ? "UNCHANGED"
              : input.unitCost === null
                ? "CLEAR"
                : "SET",
          costValue:
            typeof input.unitCost === "number"
              ? input.unitCost.toString()
              : null,
        }
      : {
          operation: input.operation,
          productId: input.productId,
          quantity: input.quantity,
          reference: input.reference ?? null,
          reason: input.reason,
        };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

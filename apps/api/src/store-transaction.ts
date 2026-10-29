import { Prisma } from "@prisma/client";

import { HttpError } from "./lib.js";

/**
 * Retry a serializable Store operation up to three times.
 * Only Prisma P2034 conflicts qualify for retry.
 * No database connection is created by this helper.
 */
export async function withStoreTransactionRetry<T>(
  executeTransaction: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await executeTransaction();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      ) {
        throw error;
      }
    }
  }

  throw new HttpError(
    409,
    "STORE_CONCURRENT_CONFLICT",
    "Inventory changed concurrently. Refresh the cart and try again.",
  );
}

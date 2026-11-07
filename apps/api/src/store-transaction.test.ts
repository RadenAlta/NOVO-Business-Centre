import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { withSerializableTransactionRetry, withStoreTransactionRetry } from "./store-transaction.js";

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Synthetic Prisma error",
    { code, clientVersion: "6.19.3" },
  );
}

describe("Store P2034 transaction retry", () => {
  it("uses the caller's domain-specific conflict contract", async () => {
    const execute = vi.fn(async () => {
      throw prismaError("P2034");
    });

    await expect(
      withSerializableTransactionRetry(execute, {
        code: "SHUTTLE_CONCURRENT_CONFLICT",
        message: "Shuttle records changed concurrently.",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "SHUTTLE_CONCURRENT_CONFLICT",
      message: "Shuttle records changed concurrently.",
    });

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1, 2])(
    "succeeds after %i retryable conflicts",
    async (conflicts) => {
      const execute = vi.fn(async () => "success");

      for (let i = 0; i < conflicts; i += 1) {
        execute.mockRejectedValueOnce(prismaError("P2034"));
      }

      await expect(
        withStoreTransactionRetry(execute),
      ).resolves.toBe("success");

      expect(execute).toHaveBeenCalledTimes(conflicts + 1);
    },
  );

  it("returns Store-specific 409 after three P2034 conflicts", async () => {
    const execute = vi.fn(async () => {
      throw prismaError("P2034");
    });

    await expect(
      withStoreTransactionRetry(execute),
    ).rejects.toMatchObject({
      status: 409,
      code: "STORE_CONCURRENT_CONFLICT",
    });

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("does not retry other Prisma errors", async () => {
    const original = prismaError("P2002");
    const execute = vi.fn(async () => {
      throw original;
    });

    await expect(
      withStoreTransactionRetry(execute),
    ).rejects.toBe(original);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not retry ordinary application errors", async () => {
    const original = new Error("Synthetic application error");
    const execute = vi.fn(async () => {
      throw original;
    });

    await expect(
      withStoreTransactionRetry(execute),
    ).rejects.toBe(original);

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

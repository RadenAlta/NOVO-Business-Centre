import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

describe("web API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends credentialed JSON requests with an optional bearer token and custom headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "product-1", name: "Snack Box" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api<{ id: string; name: string }>(
        "/products",
        { method: "POST", body: JSON.stringify({ sku: "SNACK-01" }), headers: { "x-request-id": "request-1" } },
        "access-token",
      ),
    ).resolves.toEqual({ id: "product-1", name: "Snack Box" });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/v1/products", {
      credentials: "include",
      method: "POST",
      body: JSON.stringify({ sku: "SNACK-01" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer access-token",
        "x-request-id": "request-1",
      },
    });
  });

  it("returns undefined for an accepted no-content response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api<void>("/session")).resolves.toBeUndefined();
  });

  it("preserves API error status, code, and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "INSUFFICIENT_STOCK", message: "Stock is unavailable." } }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(api("/sales")).rejects.toMatchObject({
      name: "Error",
      status: 409,
      code: "INSUFFICIENT_STOCK",
      message: "Stock is unavailable.",
    });
  });
});

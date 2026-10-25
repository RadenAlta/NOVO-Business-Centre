import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearActiveSession, setActiveSession, type Session } from "./api.js";

const session: Session = {
  user: { id: "user-1", name: "Nia", email: "nia@example.test", role: "ADMIN", tenantId: "tenant-1" },
  tenant: { id: "tenant-1", name: "NOVO Test", slug: "novo-test" },
  csrfToken: "csrf-test-token",
};

describe("web API client", () => {
  afterEach(() => {
    clearActiveSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses credentialed cookies and memory-only CSRF, never an authorization bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "product-1", name: "Snack Box" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    setActiveSession(session);

    await expect(api<{ id: string; name: string }>("/products", { method: "POST", body: JSON.stringify({ sku: "SNACK-01" }), headers: { "x-request-id": "request-1" } })).resolves.toEqual({ id: "product-1", name: "Snack Box" });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/v1/products", {
      credentials: "include",
      method: "POST",
      body: JSON.stringify({ sku: "SNACK-01" }),
      headers: { "content-type": "application/json", "x-novo-csrf": "csrf-test-token", "x-request-id": "request-1" },
    });
  });

  it("keeps multipart boundaries intact while still sending CSRF", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "attachment-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    setActiveSession(session);
    const form = new FormData();
    form.append("entityType", "Receipt");

    await api("/attachments", { method: "POST", body: form });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", headers: { "x-novo-csrf": "csrf-test-token" } });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty("content-type");
  });

  it("returns undefined for an accepted no-content response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api<void>("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("preserves API error status, code, and message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INSUFFICIENT_STOCK", message: "Stock is unavailable." } }), { status: 409, headers: { "content-type": "application/json" } })));
    await expect(api("/sales")).rejects.toMatchObject({ name: "Error", status: 409, code: "INSUFFICIENT_STOCK", message: "Stock is unavailable." });
  });
});
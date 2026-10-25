import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { Session } from "./api";
import { discardProtectedQueries, protectedQueryKey } from "./session-cache";

const tenant = { id: "tenant-1", name: "NOVO Test", slug: "novo-test" };
const firstUser: Session = { tenant, user: { id: "user-a", name: "Ayu", email: "ayu@example.test", role: "ADMIN", tenantId: tenant.id }, csrfToken: "csrf-a" };
const secondUser: Session = { tenant, user: { id: "user-b", name: "Bima", email: "bima@example.test", role: "VIEWER", tenantId: tenant.id }, csrfToken: "csrf-b" };

const clients: QueryClient[] = [];
function createClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe("protected React Query cache", () => {
  it("does not expose one same-tenant principal's cached data to another principal", () => {
    const client = createClient();
    const firstKey = protectedQueryKey("dashboard", firstUser);
    const secondKey = protectedQueryKey("dashboard", secondUser);
    client.setQueryData(firstKey, { customerName: "Synthetic Ayu Customer" });

    expect(firstKey).not.toEqual(secondKey);
    expect(client.getQueryData(secondKey)).toBeUndefined();
  });

  it("cancels and removes protected cache entries at logout or account switch", async () => {
    const client = createClient();
    const firstKey = protectedQueryKey("master-data", firstUser);
    client.setQueryData(firstKey, { data: [{ fullName: "Synthetic Record" }] });

    await discardProtectedQueries(client);

    expect(client.getQueryData(firstKey)).toBeUndefined();
  });
});
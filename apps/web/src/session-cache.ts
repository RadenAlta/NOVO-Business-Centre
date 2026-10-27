import type { QueryClient } from "@tanstack/react-query";
import type { Session } from "./api";

export const protectedQueryScope = ["novo-protected"] as const;

export function protectedQueryKey(resource: string, session: Session, queryScope?: string) {
  return [...protectedQueryScope, resource, session.tenant.id, session.user.id, session.user.role, ...(queryScope ? [queryScope] : [])] as const;
}

export function protectedQueryPrefix(resource?: string) {
  return resource ? [...protectedQueryScope, resource] as const : protectedQueryScope;
}

export async function discardProtectedQueries(client: QueryClient): Promise<void> {
  try {
    await client.cancelQueries({ queryKey: protectedQueryScope });
  } catch {
    // Query cancellation is best effort; stale protected values must still be removed.
  } finally {
    client.removeQueries({ queryKey: protectedQueryScope });
  }
}
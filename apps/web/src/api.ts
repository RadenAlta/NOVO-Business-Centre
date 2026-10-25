const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

export type Session = {
  user: { id: string; name: string; email: string; role: string; tenantId: string };
  tenant: { id: string; name: string; slug: string };
  csrfToken: string;
};

let csrfToken: string | undefined;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

export function setActiveSession(session: Session | null): void {
  csrfToken = session?.csrfToken;
}

export function clearActiveSession(): void {
  csrfToken = undefined;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !isFormData && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (["POST", "PUT", "PATCH", "DELETE"].includes((options.method ?? "GET").toUpperCase()) && csrfToken) {
    headers.set("x-novo-csrf", csrfToken);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: "include",
    headers: Object.fromEntries(headers.entries()),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string; code?: string } } | undefined;
    if (response.status === 401) {
      clearActiveSession();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("novo:unauthenticated"));
    }
    throw new ApiError(response.status, body?.error?.message ?? "Request failed.", body?.error?.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
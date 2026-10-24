const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

export type Session = { token: string; user: { id: string; name: string; email: string; role: string; tenantId: string }; tenant: { id: string; name: string; slug: string } };

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...options,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string; code?: string } } | undefined;
    throw new ApiError(response.status, body?.error?.message ?? "Request failed.", body?.error?.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const storeSession = (session: Session | null) => {
  if (session) sessionStorage.setItem("novo.session", JSON.stringify(session));
  else sessionStorage.removeItem("novo.session");
};

export const readSession = (): Session | null => {
  const raw = sessionStorage.getItem("novo.session");
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { storeSession(null); return null; }
};

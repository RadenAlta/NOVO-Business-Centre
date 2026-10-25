import { ApiError } from "./api";

export type LogoutConfirmation = "confirmed" | "unconfirmed";

export async function requestServerLogout(request: () => Promise<void>): Promise<LogoutConfirmation> {
  try {
    await request();
    return "confirmed";
  } catch (error) {
    // A 401 means the server already treats the session as invalid, so no local credential remains usable.
    if (error instanceof ApiError && error.status === 401) return "confirmed";
    return "unconfirmed";
  }
}
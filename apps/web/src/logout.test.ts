import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { requestServerLogout } from "./logout";

describe("server logout confirmation", () => {
  it("confirms local sign-out only after server revocation succeeds", async () => {
    await expect(requestServerLogout(async () => undefined)).resolves.toBe("confirmed");
  });

  it("keeps the local session when a server or network failure leaves revocation unconfirmed", async () => {
    await expect(requestServerLogout(async () => { throw new ApiError(500, "Temporary failure."); })).resolves.toBe("unconfirmed");
    await expect(requestServerLogout(async () => { throw new Error("Network unavailable."); })).resolves.toBe("unconfirmed");
  });

  it("treats a 401 as already invalidated rather than claiming a failed logout", async () => {
    await expect(requestServerLogout(async () => { throw new ApiError(401, "Session expired."); })).resolves.toBe("confirmed");
  });
});
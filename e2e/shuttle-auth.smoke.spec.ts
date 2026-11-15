import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, request as playwrightRequest, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
function findWorkspaceRoot(startDirectory: string): string {
  let candidate = resolve(startDirectory);
  while (true) {
    const fixture = resolve(candidate, "apps", "api", "src", "e2e-fixture.ts");
    if (existsSync(resolve(candidate, "package.json")) && existsSync(fixture)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Unable to locate the NOVO workspace for the E2E fixture.");
    candidate = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
const apiWorkspace = resolve(workspaceRoot, "apps", "api");
const fixtureScript = resolve(apiWorkspace, "src", "e2e-fixture.ts");

type Fixture = {
  tenantId: string;
  tenantSlug: string;
  email: string;
  password: string;
  routeName: string;
  subscriptionRiderName: string;
};

async function fixture(command: "create" | "cleanup", tenantId?: string): Promise<Fixture | undefined> {
  if (!existsSync(fixtureScript)) throw new Error("The isolated API E2E fixture script is unavailable.");
  const args = ["--import", "tsx", "src/e2e-fixture.ts", command];
  if (tenantId) args.push(tenantId);
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: apiWorkspace,
    env: process.env,
    windowsHide: true,
  });
  return command === "create" ? JSON.parse(stdout) as Fixture : undefined;
}

test.describe("SO Shuttle authenticated browser smoke", () => {
  test.describe.configure({ mode: "serial" });
  let data: Fixture | undefined;

  test.beforeEach(async () => {
    data = await fixture("create") as Fixture;
  });

  test.afterEach(async () => {
    if (data) await fixture("cleanup", data.tenantId);
  });

  test("logs in through the UI, loads Shuttle, and rejects a replayed revoked session", async ({ page, context, baseURL }) => {
    if (!data) throw new Error("E2E fixture is unavailable.");
    const browserErrors: Error[] = [];
    page.on("pageerror", (error) => browserErrors.push(error));

    await page.goto("/");
    await page.getByLabel("Slug workspace").fill(data.tenantSlug);
    await page.getByLabel("Email").fill(data.email);
    await page.getByLabel("Kata sandi").fill(data.password);
    await page.getByRole("button", { name: "Masuk ke NOVO" }).click();
    await expect(page.getByRole("link", { name: "Shuttle" })).toBeVisible();

    const cookies = await context.cookies("http://localhost:4000/api/v1");
    const sessionCookie = cookies.find((cookie) => cookie.name === "novo_session");
    expect(sessionCookie).toMatchObject({ httpOnly: true, secure: false, sameSite: "Lax" });
    expect(sessionCookie?.value).toBeTruthy();
    const replayCookie = `novo_session=${sessionCookie?.value}`;

    const apiBaseUrl = "http://localhost:4000/api/v1";
    const sessionEndpoint = `${apiBaseUrl}/me`;
    const sessionRead = await context.request.get(sessionEndpoint);
    expect(sessionRead.status()).toBe(200);
    await expect(sessionRead.json()).resolves.toMatchObject({
      user: { email: data.email },
      tenant: { slug: data.tenantSlug },
      csrfToken: expect.any(String),
    });

    await page.getByRole("link", { name: "Shuttle" }).click();
    await expect(page).toHaveURL(/\/shuttle$/);
    await expect(page.getByRole("heading", { name: "Operasional Shuttle" })).toBeVisible();
    await expect(page.getByText(data.routeName, { exact: true })).toBeVisible();
    await expect(page.getByText(data.subscriptionRiderName)).toBeVisible();
    expect(browserErrors).toEqual([]);

    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page.getByRole("button", { name: "Masuk ke NOVO" })).toBeVisible();

    const replay = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: replayCookie },
    });
    try {
      expect((await replay.get(sessionEndpoint)).status()).toBe(401);
    } finally {
      await replay.dispose();
    }

    // The fixture is synthetic; its session token never appears in a selector, log, snapshot, or artifact.
    expect(baseURL).toBeTruthy();
  });
});

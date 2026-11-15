import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const finalModelVersion = "activity-category-v0.2-39098d6f4f26";
const allowedCategories = ["INVENTORY", "SALES", "SERVICE", "ADMINISTRATION"];

function findWorkspaceRoot(startDirectory: string): string {
  let candidate = resolve(startDirectory);
  while (true) {
    const fixture = resolve(candidate, "apps", "api", "src", "e2e-fixture.ts");
    if (existsSync(resolve(candidate, "package.json")) && existsSync(fixture)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Unable to locate the NOVO workspace for the F4 E2E fixture.");
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
  viewerEmail: string;
  viewerPassword: string;
};

type ActivityClassificationState = {
  classificationAuditCount: number;
  classificationAuditAfter: unknown[];
  aiInteractionCount: number;
  invoiceCount: number;
  shuttleSettlementCount: number;
  stockMovementCount: number;
};

async function fixture(
  command: "create" | "cleanup" | "f4-state",
  tenantId?: string,
): Promise<Fixture | ActivityClassificationState | undefined> {
  if (!existsSync(fixtureScript)) throw new Error("The isolated API E2E fixture script is unavailable.");
  const args = ["--import", "tsx", "src/e2e-fixture.ts", command];
  if (tenantId) args.push(tenantId);
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: apiWorkspace,
    env: process.env,
    windowsHide: true,
  });
  return command === "cleanup" ? undefined : JSON.parse(stdout) as Fixture | ActivityClassificationState;
}

async function login(
  page: import("@playwright/test").Page,
  fixtureData: Fixture,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Slug workspace").fill(fixtureData.tenantSlug);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk ke NOVO" }).click();
  await expect(page.getByRole("link", { name: "Kategori Aktivitas" })).toBeVisible();
}

test.describe("F4 real browser service integration", () => {
  test.describe.configure({ mode: "serial" });
  let data: Fixture | undefined;

  test.beforeEach(async () => {
    data = await fixture("create") as Fixture;
  });

  test.afterEach(async () => {
    if (data) await fixture("cleanup", data.tenantId);
  });

  test("uses the real Express proxy and final FastAPI model without persisting an activity", async ({ browser, page }) => {
    if (!data) throw new Error("F4 fixture is unavailable.");
    const note = "Petugas gudang memeriksa stok minuman sintetis sebelum toko dibuka.";
    const before = await fixture("f4-state", data.tenantId) as ActivityClassificationState;
    expect(before).toMatchObject({
      classificationAuditCount: 0,
      aiInteractionCount: 0,
      invoiceCount: 0,
      shuttleSettlementCount: 0,
      stockMovementCount: 0,
    });

    await login(page, data, data.email, data.password);
    await page.getByRole("link", { name: "Kategori Aktivitas" }).click();
    await expect(page).toHaveURL(/\/activity-classification$/);
    const noteInput = page.getByLabel("Catatan terdeidentifikasi");
    await noteInput.fill("  ");
    await expect(page.getByRole("button", { name: "Minta saran kategori" })).toBeDisabled();

    await noteInput.fill(note);
    const requestPromise = page.waitForRequest((request) =>
      request.url() === "http://localhost:4000/api/v1/analytics/activity-classification"
      && request.method() === "POST",
    );
    const responsePromise = page.waitForResponse((response) =>
      response.url() === "http://localhost:4000/api/v1/analytics/activity-classification"
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Minta saran kategori" }).click();
    const [request, response] = await Promise.all([requestPromise, responsePromise]);
    expect(await request.headerValue("origin")).toBe("http://localhost:5173");
    expect(await request.headerValue("x-novo-csrf")).toBeTruthy();
    expect(request.postDataJSON()).toEqual({ noteDeidentified: note });
    expect(response.status()).toBe(200);
    const body = await response.json() as {
      predictedCategory: string;
      modelVersion: string;
      inferenceStatus: string;
    };
    expect(allowedCategories).toContain(body.predictedCategory);
    expect(body).toMatchObject({
      modelVersion: finalModelVersion,
      inferenceStatus: "SUCCESS",
    });
    await expect(page.getByText(`Saran AI: ${body.predictedCategory}`)).toBeVisible();

    await page.getByRole("button", { name: "Gunakan saran sebagai draft" }).click();
    await page.getByLabel("Kategori draft manual").selectOption("SERVICE");
    await expect(page.getByText(/Kategori SERVICE dipilih sebagai draft manual/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Kategori draft manual")).toHaveValue("");
    await expect(page.getByText("Belum ada saran AI. Pilih kategori manual jika diperlukan.")).toBeVisible();

    const after = await fixture("f4-state", data.tenantId) as ActivityClassificationState;
    expect(after).toMatchObject({
      classificationAuditCount: 1,
      aiInteractionCount: 0,
      invoiceCount: 0,
      shuttleSettlementCount: 0,
      stockMovementCount: 0,
    });
    expect(JSON.stringify(after.classificationAuditAfter)).not.toContain(note);
    expect(JSON.stringify(after.classificationAuditAfter)).toContain(body.predictedCategory);

    const viewerContext = await browser.newContext({ baseURL: "http://localhost:5173" });
    try {
      const viewerPage = await viewerContext.newPage();
      await login(viewerPage, data, data.viewerEmail, data.viewerPassword);
      await viewerPage.getByRole("link", { name: "Kategori Aktivitas" }).click();
      await expect(viewerPage.getByRole("alert")).toContainText("tidak memiliki akses");
      await expect(viewerPage.getByRole("button", { name: "Minta saran kategori" })).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });
});

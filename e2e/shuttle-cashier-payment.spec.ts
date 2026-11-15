import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);

function findWorkspaceRoot(startDirectory: string): string {
  let candidate = resolve(startDirectory);
  while (true) {
    const fixture = resolve(candidate, "apps", "api", "src", "e2e-fixture.ts");
    if (existsSync(resolve(candidate, "package.json")) && existsSync(fixture)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Unable to locate the NOVO workspace for the Cashier E2E fixture.");
    candidate = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
const apiWorkspace = resolve(workspaceRoot, "apps", "api");
const fixtureScript = resolve(apiWorkspace, "src", "e2e-fixture.ts");

type CashierFixture = {
  tenantId: string;
  tenantSlug: string;
  cashierEmail: string;
  cashierPassword: string;
  invoiceId: string;
  invoiceNo: string;
  foreignInvoiceId: string;
  foreignInvoiceNo: string;
  cleanupTenantIds: string[];
};

async function fixture(command: "create-cashier" | "cleanup", ...values: string[]): Promise<CashierFixture | undefined> {
  if (!existsSync(fixtureScript)) throw new Error("The isolated API E2E fixture script is unavailable.");
  const args = ["--import", "tsx", "src/e2e-fixture.ts", command, ...values];
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: apiWorkspace,
    env: process.env,
    windowsHide: true,
  });
  return command === "create-cashier" ? JSON.parse(stdout) as CashierFixture : undefined;
}

async function acceptPaymentConfirmation(page: Page): Promise<void> {
  page.once("dialog", (dialog) => dialog.accept());
}

test.describe("SO Shuttle Cashier payment browser journey", () => {
  test.describe.configure({ mode: "serial" });
  let data: CashierFixture | undefined;

  test.beforeEach(async () => {
    data = await fixture("create-cashier") as CashierFixture;
  });

  test.afterEach(async () => {
    if (data) await fixture("cleanup", ...data.cleanupTenantIds);
  });

  test("records two bounded partial payments without Finance access", async ({ page, context }) => {
    if (!data) throw new Error("Cashier E2E fixture is unavailable.");
    const apiBaseUrl = "http://localhost:4000/api/v1";
    const apiUrl = (path: string) => `${apiBaseUrl}${path}`;
    const sessionEndpoint = apiUrl("/me");
    const paymentForm = page.locator("form").filter({ has: page.locator('select[name="invoiceId"]') });
    const invoicePicker = paymentForm.locator('select[name="invoiceId"]');

    await page.goto("/");
    await page.getByLabel("Slug workspace").fill(data.tenantSlug);
    await page.getByLabel("Email").fill(data.cashierEmail);
    await page.getByLabel("Kata sandi").fill(data.cashierPassword);
    await page.getByRole("button", { name: "Masuk ke NOVO" }).click();
    await expect(page.getByRole("link", { name: "Shuttle" })).toBeVisible();

    const sessionRead = await context.request.get(sessionEndpoint);
    expect(sessionRead.status()).toBe(200);
    const session = await sessionRead.json() as { csrfToken: string };
    expect(session.csrfToken).toEqual(expect.any(String));
    const securedHeaders = { Origin: "http://localhost:5173", "X-Novo-Csrf": session.csrfToken };
    const sessionCookie = (await context.cookies("http://localhost:4000/api/v1")).find((cookie) => cookie.name === "novo_session");
    expect(sessionCookie).toMatchObject({ httpOnly: true, secure: false, sameSite: "Lax" });
    const replayCookie = `novo_session=${sessionCookie?.value}`;

    await page.getByRole("link", { name: "Shuttle" }).click();
    await expect(page).toHaveURL(/\/shuttle$/);
    await expect(page.getByRole("heading", { name: "Catat pembayaran" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Riwayat dan tindakan payment" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Settlement dan laporan" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Void invoice" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Verifikasi" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reverse" })).toHaveCount(0);

    expect((await context.request.get(apiUrl("/billing/invoices"))).status()).toBe(403);
    expect((await context.request.get(apiUrl("/shuttle/settlements"))).status()).toBe(403);
    const anonymous = await playwrightRequest.newContext();
    try {
      expect((await anonymous.get(apiUrl("/shuttle/billing/collectible-invoices"))).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    await page.getByLabel("Cari invoice collectible").fill(data.foreignInvoiceNo);
    await expect(invoicePicker.locator(`option[value="${data.foreignInvoiceId}"]`)).toHaveCount(0);
    await expect(page.getByText("Tidak ada invoice yang dapat ditagih.")).toBeVisible();

    await page.getByLabel("Cari invoice collectible").fill(data.invoiceNo);
    const invoiceOption = invoicePicker.locator(`option[value="${data.invoiceId}"]`);
    await expect(invoiceOption).toContainText(data.invoiceNo);
    await expect(invoiceOption).toContainText("100.000");
    await invoicePicker.selectOption(data.invoiceId);

    const amountInput = paymentForm.locator('input[name="amount"]');
    await amountInput.fill("100.5");
    await paymentForm.locator('input[name="reference"]').fill("E2E-FRACTIONAL");
    expect(await amountInput.evaluate((input: HTMLInputElement) => ({
      valid: input.checkValidity(),
      stepMismatch: input.validity.stepMismatch,
    }))).toEqual({ valid: false, stepMismatch: true });
    let fractionalBrowserPosts = 0;
    const observeFractionalPost = (request: { url(): string; method(): string }) => {
      if (request.method() === "POST" && request.url().includes(`/billing/invoices/${data!.invoiceId}/payments`)) fractionalBrowserPosts += 1;
    };
    page.on("request", observeFractionalPost);
    await paymentForm.getByRole("button", { name: "Catat pembayaran" }).click();
    page.off("request", observeFractionalPost);
    expect(fractionalBrowserPosts).toBe(0);
    expect(await amountInput.evaluate((input: HTMLInputElement) => document.activeElement === input)).toBe(true);
    const fractionalApiResponse = await context.request.post(apiUrl(`/billing/invoices/${data.invoiceId}/payments`), {
      headers: securedHeaders,
      data: { amount: 100.5, method: "CASH", reference: "E2E-FRACTIONAL-API" },
    });
    expect(fractionalApiResponse.status()).toBe(400);

    await amountInput.fill("60000");
    await paymentForm.locator('input[name="reference"]').fill("E2E-CASH-60K");
    await acceptPaymentConfirmation(page);
    const firstPaymentResponse = page.waitForResponse((response) => response.url().includes(`/billing/invoices/${data!.invoiceId}/payments`) && response.request().method() === "POST");
    await paymentForm.getByRole("button", { name: "Catat pembayaran" }).click();
    const firstPayment = await firstPaymentResponse;
    expect(firstPayment.status()).toBe(201);
    const firstPaymentBody = await firstPayment.json() as { id: string; status: string; amount: string };
    expect(firstPaymentBody).toMatchObject({ status: "RECORDED", amount: "60000" });
    await expect(page.getByText("Pembayaran dicatat.")).toBeVisible();
    await expect(invoiceOption).toContainText("40.000");

    expect((await context.request.post(apiUrl(`/billing/payments/${firstPaymentBody.id}/verify`), { headers: securedHeaders, data: {} })).status()).toBe(403);
    expect((await context.request.post(apiUrl(`/billing/payments/${firstPaymentBody.id}/reverse`), { headers: securedHeaders, data: { reason: "Cashier must not reverse payments" } })).status()).toBe(403);
    expect((await context.request.post(apiUrl(`/billing/invoices/${data.invoiceId}/void`), { headers: securedHeaders, data: { reason: "Cashier must not void invoices" } })).status()).toBe(403);
    expect((await context.request.post(apiUrl("/shuttle/billing-periods/not-a-period/settlements"), { headers: securedHeaders, data: {} })).status()).toBe(403);

    await invoicePicker.selectOption(data.invoiceId);
    await amountInput.fill("40000");
    await paymentForm.locator('input[name="reference"]').fill("E2E-CASH-40K");
    await acceptPaymentConfirmation(page);
    const secondPaymentResponse = page.waitForResponse((response) => response.url().includes(`/billing/invoices/${data!.invoiceId}/payments`) && response.request().method() === "POST");
    await paymentForm.getByRole("button", { name: "Catat pembayaran" }).click();
    const secondPayment = await secondPaymentResponse;
    expect(secondPayment.status()).toBe(201);
    const secondPaymentBody = await secondPayment.json() as { status: string; amount: string };
    expect(secondPaymentBody).toMatchObject({ status: "RECORDED", amount: "40000" });
    await expect(page.getByText("Pembayaran dicatat.")).toBeVisible();
    await expect(page.getByText("Tidak ada invoice yang dapat ditagih.")).toBeVisible();
    await expect(paymentForm.getByRole("button", { name: "Catat pembayaran" })).toBeDisabled();

    const overpayment = await context.request.post(apiUrl(`/billing/invoices/${data.invoiceId}/payments`), {
      headers: securedHeaders,
      data: { amount: 1, method: "CASH", reference: "E2E-CASH-OVERPAY" },
    });
    expect(overpayment.status()).toBe(409);
    const missingCsrf = await context.request.post(apiUrl(`/billing/invoices/${data.invoiceId}/payments`), {
      headers: { Origin: "http://localhost:5173" },
      data: { amount: 1, method: "CASH", reference: "E2E-CASH-CSRF" },
    });
    expect(missingCsrf.status()).toBe(403);
    const foreignTarget = await context.request.post(apiUrl(`/billing/invoices/${data.foreignInvoiceId}/payments`), {
      headers: securedHeaders,
      data: { amount: 1, method: "CASH", reference: "E2E-CASH-FOREIGN" },
    });
    expect(foreignTarget.status()).toBe(404);

    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page.getByRole("button", { name: "Masuk ke NOVO" })).toBeVisible();
    const replay = await playwrightRequest.newContext({ extraHTTPHeaders: { Cookie: replayCookie } });
    try {
      expect((await replay.get(sessionEndpoint)).status()).toBe(401);
    } finally {
      await replay.dispose();
    }
  });
});

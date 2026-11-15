import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Dialog, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);
const apiBaseUrl = "http://localhost:4000/api/v1";
const apiUrl = (path: string) => `${apiBaseUrl}${path}`;

function findWorkspaceRoot(startDirectory: string): string {
  let candidate = resolve(startDirectory);
  while (true) {
    const fixture = resolve(candidate, "apps", "api", "src", "e2e-fixture.ts");
    if (existsSync(resolve(candidate, "package.json")) && existsSync(fixture)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("Unable to locate the NOVO workspace for the Finance E2E fixture.");
    candidate = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
const apiWorkspace = resolve(workspaceRoot, "apps", "api");
const fixtureScript = resolve(apiWorkspace, "src", "e2e-fixture.ts");

type FinanceFixture = {
  tenantId: string;
  tenantSlug: string;
  email: string;
  password: string;
  cashierEmail: string;
  cashierPassword: string;
  financeEmail: string;
  financePassword: string;
  invoiceId: string;
  invoiceNo: string;
  foreignInvoiceId: string;
  cleanupTenantIds: string[];
};

type PaymentResponse = { id: string; status: string; amount: string };
type SettlementResponse = {
  id: string;
  status: string;
  verifiedAmount: number;
  vendorAmount: number;
  cooperativeAmount: number;
};

async function fixture(command: "create-cashier" | "cleanup", ...values: string[]): Promise<FinanceFixture | undefined> {
  if (!existsSync(fixtureScript)) throw new Error("The isolated API E2E fixture script is unavailable.");
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/e2e-fixture.ts", command, ...values],
    { cwd: apiWorkspace, env: process.env, windowsHide: true },
  );
  return command === "create-cashier" ? JSON.parse(stdout) as FinanceFixture : undefined;
}

async function login(page: Page, tenantSlug: string, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Slug workspace").fill(tenantSlug);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk ke NOVO" }).click();
  await expect(page.getByRole("link", { name: "Shuttle" })).toBeVisible();
}

function acceptConfirmation(page: Page): void {
  page.once("dialog", (dialog) => dialog.accept());
}

function acceptSettlementPaymentDialogs(page: Page, reference: string): void {
  const handler = (dialog: Dialog) => {
    if (dialog.type() === "prompt") {
      void dialog.accept(reference);
      return;
    }
    if (dialog.type() === "confirm") {
      page.off("dialog", handler);
      void dialog.accept();
      return;
    }
    page.off("dialog", handler);
    void dialog.dismiss();
  };
  page.on("dialog", handler);
}

test.describe("SO Shuttle finance-controlled browser journey", () => {
  test.describe.configure({ mode: "serial" });
  let data: FinanceFixture | undefined;

  test.beforeEach(async () => {
    data = await fixture("create-cashier") as FinanceFixture;
  });

  test.afterEach(async () => {
    if (data) {
      // The financial journey creates ShuttleSettlementPayment rows. Repeat the
      // scoped cleanup to prove that a successful teardown is idempotent.
      await fixture("cleanup", ...data.cleanupTenantIds);
      await fixture("cleanup", ...data.cleanupTenantIds);
    }
  });

  test("keeps Finance Officer read-only for approval while a Super Admin verifies, settles, and reconciles whole Rupiah", async ({ page, context }) => {
    if (!data) throw new Error("Finance E2E fixture is unavailable.");
    const cashierPaymentForm = page.locator("form").filter({ has: page.locator('select[name="invoiceId"]') });
    const invoicePicker = cashierPaymentForm.locator('select[name="invoiceId"]');

    await login(page, data.tenantSlug, data.cashierEmail, data.cashierPassword);
    await page.getByRole("link", { name: "Shuttle" }).click();
    await expect(invoicePicker.locator(`option[value="${data.invoiceId}"]`)).toContainText(data.invoiceNo);

    await invoicePicker.selectOption(data.invoiceId);
    await cashierPaymentForm.locator('input[name="amount"]').fill("60000");
    await cashierPaymentForm.locator('input[name="reference"]').fill("E2E-FIN-60K");
    acceptConfirmation(page);
    const firstRecordedResponse = page.waitForResponse((response) =>
      response.url() === apiUrl(`/billing/invoices/${data!.invoiceId}/payments`)
      && response.request().method() === "POST",
    );
    await cashierPaymentForm.getByRole("button", { name: "Catat pembayaran" }).click();
    const firstRecorded = await firstRecordedResponse;
    expect(firstRecorded.status()).toBe(201);
    const firstPayment = await firstRecorded.json() as PaymentResponse;
    expect(firstPayment).toMatchObject({ status: "RECORDED", amount: "60000" });

    await invoicePicker.selectOption(data.invoiceId);
    await cashierPaymentForm.locator('input[name="amount"]').fill("40000");
    await cashierPaymentForm.locator('input[name="reference"]').fill("E2E-FIN-40K");
    acceptConfirmation(page);
    const secondRecordedResponse = page.waitForResponse((response) =>
      response.url() === apiUrl(`/billing/invoices/${data!.invoiceId}/payments`)
      && response.request().method() === "POST",
    );
    await cashierPaymentForm.getByRole("button", { name: "Catat pembayaran" }).click();
    const secondRecorded = await secondRecordedResponse;
    expect(secondRecorded.status()).toBe(201);
    const secondPayment = await secondRecorded.json() as PaymentResponse;
    expect(secondPayment).toMatchObject({ status: "RECORDED", amount: "40000" });
    await page.getByRole("button", { name: "Keluar" }).click();

    // FINANCE_OFFICER is deliberately read/payment-record only under the current
    // provisional RBAC matrix. This assertion prevents an accidental privilege
    // escalation while the PIC decision remains open.
    await login(page, data.tenantSlug, data.financeEmail, data.financePassword);
    await page.getByRole("link", { name: "Shuttle" }).click();
    const firstFinanceRow = page.locator(".shuttle-payment").filter({ hasText: "E2E-FIN-60K" });
    const secondFinanceRow = page.locator(".shuttle-payment").filter({ hasText: "E2E-FIN-40K" });
    await expect(firstFinanceRow.getByText("Status: RECORDED", { exact: true })).toBeVisible();
    await expect(secondFinanceRow.getByText("Status: RECORDED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verifikasi" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Settlement dan laporan" })).toHaveCount(0);
    const financeSession = await context.request.get(apiUrl("/me"));
    expect(financeSession.status()).toBe(200);
    const financeCsrf = (await financeSession.json() as { csrfToken: string }).csrfToken;
    const financeVerify = await context.request.post(apiUrl(`/billing/payments/${firstPayment.id}/verify`), {
      headers: { Origin: "http://localhost:5173", "X-Novo-Csrf": financeCsrf },
      data: {},
    });
    expect(financeVerify.status()).toBe(403);
    await page.getByRole("button", { name: "Keluar" }).click();

    await login(page, data.tenantSlug, data.email, data.password);
    const ownerSession = await context.request.get(apiUrl("/me"));
    expect(ownerSession.status()).toBe(200);
    const ownerCsrf = (await ownerSession.json() as { csrfToken: string }).csrfToken;
    expect((await context.request.post(apiUrl(`/billing/payments/${firstPayment.id}/verify`), {
      headers: { Origin: "http://localhost:5173", "X-Novo-Csrf": "invalid-csrf" },
      data: {},
    })).status()).toBe(403);
    expect((await context.request.post(apiUrl(`/billing/invoices/${data.foreignInvoiceId}/payments`), {
      headers: { Origin: "http://localhost:5173", "X-Novo-Csrf": ownerCsrf },
      data: { amount: 1, method: "CASH", reference: "E2E-FIN-FOREIGN" },
    })).status()).toBe(404);

    await page.getByRole("link", { name: "Shuttle" }).click();
    await expect(page.getByRole("heading", { name: "Settlement dan laporan" })).toBeVisible();
    const firstOwnerRow = page.locator(".shuttle-payment").filter({ hasText: "E2E-FIN-60K" });
    const secondOwnerRow = page.locator(".shuttle-payment").filter({ hasText: "E2E-FIN-40K" });
    const invoiceRow = page.locator(".shuttle-section").filter({ has: page.getByRole("heading", { name: "Periode dan invoice" }) }).locator(".list-row").filter({ hasText: data.invoiceNo });
    await expect(firstOwnerRow.getByText("Status: RECORDED", { exact: true })).toBeVisible();
    await expect(secondOwnerRow.getByText("Status: RECORDED", { exact: true })).toBeVisible();
    await expect(invoiceRow).toContainText(/100\.000/);

    acceptConfirmation(page);
    const firstVerifyResponse = page.waitForResponse((response) =>
      response.url() === apiUrl(`/billing/payments/${firstPayment.id}/verify`)
      && response.request().method() === "POST",
    );
    await firstOwnerRow.getByRole("button", { name: "Verifikasi" }).click();
    expect((await firstVerifyResponse).status()).toBe(200);
    await expect(firstOwnerRow.getByText("Status: VERIFIED", { exact: true })).toBeVisible();
    await expect(invoiceRow).toContainText(/40\.000/);

    acceptConfirmation(page);
    const secondVerifyResponse = page.waitForResponse((response) =>
      response.url() === apiUrl(`/billing/payments/${secondPayment.id}/verify`)
      && response.request().method() === "POST",
    );
    await secondOwnerRow.getByRole("button", { name: "Verifikasi" }).click();
    expect((await secondVerifyResponse).status()).toBe(200);
    await expect(secondOwnerRow.getByText("Status: VERIFIED", { exact: true })).toBeVisible();
    await expect(invoiceRow).toContainText("PAID");
    await expect(invoiceRow).toContainText(/Rp\s*0/);
    expect((await context.request.post(apiUrl(`/billing/payments/${secondPayment.id}/verify`), {
      headers: { Origin: "http://localhost:5173", "X-Novo-Csrf": ownerCsrf },
      data: {},
    })).status()).toBe(200);

    const configForm = page.locator("form").filter({ has: page.locator('input[name="vendorName"]') });
    await configForm.locator('input[name="vendorName"]').fill("Vendor E2E Sintetis");
    await configForm.locator('input[name="vendorShareBps"]').fill("6000");
    await configForm.locator('input[name="cooperativeShareBps"]').fill("4000");
    acceptConfirmation(page);
    const configResponse = page.waitForResponse((response) => response.url() === apiUrl("/shuttle/financial-config") && response.request().method() === "PUT");
    await configForm.getByRole("button", { name: "Simpan konfigurasi" }).click();
    expect((await configResponse).status()).toBe(200);

    acceptConfirmation(page);
    const settlementResponse = page.waitForResponse((response) =>
      response.url().includes("/shuttle/billing-periods/")
      && response.url().endsWith("/settlements")
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Settlement", exact: true }).click();
    const settlement = await settlementResponse;
    expect(settlement.status()).toBe(201);
    const settlementBody = await settlement.json() as SettlementResponse;
    expect(settlementBody).toMatchObject({ status: "DRAFT", verifiedAmount: 100000, vendorAmount: 60000, cooperativeAmount: 40000 });
    expect(settlementBody.vendorAmount + settlementBody.cooperativeAmount).toBe(settlementBody.verifiedAmount);

    const settlementRow = page.locator(".shuttle-section").filter({ has: page.getByRole("heading", { name: "Settlement dan laporan" }) }).locator(".list-row").filter({ hasText: "Vendor E2E Sintetis" });
    await expect(settlementRow).toContainText("DRAFT");
    await expect(settlementRow).toContainText(/100\.000/);
    acceptConfirmation(page);
    const approveResponse = page.waitForResponse((response) => response.url() === apiUrl(`/shuttle/settlements/${settlementBody.id}/approve`) && response.request().method() === "POST");
    await settlementRow.getByRole("button", { name: "Setujui" }).click();
    expect((await approveResponse).status()).toBe(200);
    await expect(settlementRow).toContainText("APPROVED");

    acceptSettlementPaymentDialogs(page, "E2E-FIN-SETTLEMENT-PAID");
    const paidResponse = page.waitForResponse((response) => response.url() === apiUrl(`/shuttle/settlements/${settlementBody.id}/mark-paid`) && response.request().method() === "POST");
    await settlementRow.getByRole("button", { name: "Tandai paid" }).click();
    expect((await paidResponse).status()).toBe(200);
    await expect(settlementRow).toContainText("PAID");

    const dashboard = page.getByRole("heading", { name: "Dashboard Shuttle" }).locator("..");
    await expect(dashboard).toContainText("Ditagihkan");
    await expect(dashboard).toContainText("Terverifikasi");
    await expect(dashboard).toContainText("Tunggakan");
    await expect(dashboard).toContainText(/100\.000/);
    await expect(dashboard).toContainText(/60\.000/);
    await expect(dashboard).toContainText(/40\.000/);
    await expect(dashboard).toContainText(/Rp\s*0/);

    const report = await context.request.get(apiUrl("/shuttle/report"));
    expect(report.status()).toBe(200);
    await expect(report.json()).resolves.toMatchObject({
      billed: 100000,
      paid: 100000,
      outstanding: 0,
      vendorShare: 60000,
      cooperativeShare: 40000,
      settlements: [expect.objectContaining({ id: settlementBody.id, status: "PAID" })],
    });
    await page.reload();
    await expect(secondOwnerRow.getByText("Status: VERIFIED", { exact: true })).toBeVisible();
    await expect(invoiceRow).toContainText("PAID");
    await expect(settlementRow).toContainText("PAID");
  });
});

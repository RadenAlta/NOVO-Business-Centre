import { expect, test, type Page } from "@playwright/test";

type MockOptions = {
  role?: string;
  providerAvailable?: boolean;
};

async function mockActivityApi(page: Page, options: MockOptions = {}): Promise<void> {
  const role = options.role ?? "ANALYST";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/me" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "f4-user", name: "F4 Synthetic User", email: "f4@example.test", role, tenantId: "f4-tenant" },
          tenant: { id: "f4-tenant", name: "F4 Synthetic Tenant", slug: "f4-synthetic" },
          csrfToken: "f4-synthetic-csrf",
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/analytics/activity-classification" && request.method() === "POST") {
      if (options.providerAvailable === false) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "ML_SERVICE_UNAVAILABLE", message: "Model unavailable." } }) });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          predictedCategory: "INVENTORY",
          confidence: 0.91,
          modelVersion: "activity-category-v0.2-39098d6f4f26",
          labelVersion: "activity-category-v0.1",
          inferenceStatus: "SUCCESS",
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Synthetic route not configured." } }) });
  });
}

test.describe("F4 activity-classification mocked browser UI", () => {
  test("accepts a suggestion, permits a manual correction, and never claims draft persistence", async ({ page }) => {
    await mockActivityApi(page);
    await page.goto("/activity-classification");

    await expect(page.getByRole("heading", { name: "Klasifikasi aktivitas" })).toBeVisible();
    const note = page.getByLabel("Catatan terdeidentifikasi");
    await note.fill("Petugas gudang memeriksa stok minuman sebelum toko dibuka.");
    await expect(page.getByRole("button", { name: "Minta saran kategori" })).toBeEnabled();
    await page.getByRole("button", { name: "Minta saran kategori" }).click();
    await expect(page.getByText("Saran AI: INVENTORY")).toBeVisible();

    await page.getByRole("button", { name: "Gunakan saran sebagai draft" }).click();
    await expect(page.getByLabel("Kategori draft manual")).toHaveValue("INVENTORY");
    await expect(page.getByText(/Kategori INVENTORY dipilih sebagai draft/)).toBeVisible();

    await page.getByLabel("Kategori draft manual").selectOption("SERVICE");
    await expect(page.getByText(/Kategori SERVICE dipilih sebagai draft/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Kategori draft manual")).toHaveValue("");
    await expect(page.getByText("Belum ada saran AI. Pilih kategori manual jika diperlukan.")).toBeVisible();
  });

  test("prevents invalid submission and offers a manual draft after an unavailable model service", async ({ page }) => {
    await mockActivityApi(page, { providerAvailable: false });
    await page.goto("/activity-classification");

    const note = page.getByLabel("Catatan terdeidentifikasi");
    await note.fill("  ");
    await expect(page.getByRole("button", { name: "Minta saran kategori" })).toBeDisabled();

    await note.fill("Catatan operasional sintetis yang valid.");
    await page.getByRole("button", { name: "Minta saran kategori" }).click();
    await expect(page.getByRole("alert")).toContainText("Pilih kategori secara manual");
    await page.getByLabel("Kategori draft manual").selectOption("ADMINISTRATION");
    await expect(page.getByText(/belum disimpan ke database/i)).toBeVisible();
  });

  test("shows a least-privilege denial for a role without F4 permission", async ({ page }) => {
    await mockActivityApi(page, { role: "VIEWER" });
    await page.goto("/activity-classification");

    await expect(page.getByRole("alert")).toContainText("tidak memiliki akses");
    await expect(page.getByRole("button", { name: "Minta saran kategori" })).toHaveCount(0);
  });
});

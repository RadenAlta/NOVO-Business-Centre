import { describe, expect, it, vi } from "vitest";
import { canCommitImport, commitMasterDataImport, makeImportPreviewForm, membershipEligibilityMessage, previewMasterDataImport, type ImportPreview } from "./master-data-import";

const readyPreview: ImportPreview = {
  previewId: "preview-1",
  fingerprint: "a".repeat(64),
  expiresAt: "2026-10-26T12:00:00.000Z",
  summary: { create: 1, update: 0, skip: 0, error: 0 },
  rows: [{ row: 2, action: "create", identifier: "SYN-001" }],
  issues: [],
};

describe("Master Data import client", () => {
  it("creates a multipart preview request without committing records", async () => {
    const file = new File(["synthetic workbook"], "synthetic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const request = vi.fn().mockResolvedValue(readyPreview);

    await expect(previewMasterDataImport(file, request)).resolves.toEqual(readyPreview);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/master-data/imports/preview", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect((makeImportPreviewForm(file).get("file") as File).name).toBe("synthetic.xlsx");
  });

  it("requires an error-free preview before an explicit commit", async () => {
    expect(canCommitImport({ ...readyPreview, summary: { create: 1, update: 0, skip: 0, error: 1 } })).toBe(false);
    expect(canCommitImport({ ...readyPreview, summary: { create: 0, update: 0, skip: 1, error: 0 } })).toBe(false);
    expect(canCommitImport(readyPreview)).toBe(true);

    const request = vi.fn().mockResolvedValue({ summary: readyPreview.summary });
    await commitMasterDataImport(readyPreview, request);
    expect(request).toHaveBeenCalledWith("/master-data/imports/commit", expect.objectContaining({ method: "POST", body: JSON.stringify({ previewId: "preview-1", fingerprint: "a".repeat(64) }) }));
  });

  it("explains membership eligibility without trusting a browser claim", () => {
    expect(membershipEligibilityMessage({ type: "STUDENT", active: true })).toMatch(/Siswa/);
    expect(membershipEligibilityMessage({ type: "TEACHER", active: false })).toMatch(/nonaktif/);
    expect(membershipEligibilityMessage({ type: "EMPLOYEE", active: true })).toMatch(/memenuhi/);
  });
});
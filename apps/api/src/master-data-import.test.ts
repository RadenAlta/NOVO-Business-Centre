import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { masterDataColumns, normalizeIdentifier, parseMasterDataWorkbook } from "./master-data-import.js";

async function workbookBytes(rows: Array<Record<string, string>>, headers: readonly string[] = masterDataColumns): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master Data");
  sheet.columns = masterDataColumns.map((key, index) => ({ header: headers[index] ?? "", key }));
  for (const row of rows) sheet.addRow(masterDataColumns.map((column) => row[column] ?? ""));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Master Data identifier normalization", () => {
  it("normalizes Unicode and whitespace before generating a tenant-local key", () => {
    expect(normalizeIdentifier("  ｅｍｐ-  001  ")).toBe("EMP- 001");
  });

  it("detects duplicate normalized type and identifier keys from a workbook", async () => {
    const payload = await parseMasterDataWorkbook(await workbookBytes([
      { type: "EMPLOYEE", identifier: " emp-001 ", fullName: "Pegawai Sintetis Satu", department: "Operasional", position: "Staf" },
      { type: "EMPLOYEE", identifier: "EMP-001", fullName: "Pegawai Sintetis Dua", department: "Operasional", position: "Staf" },
    ]));

    expect(payload.rows.map((row) => row.identifier)).toEqual(["EMP-001", "EMP-001"]);
    expect(payload.issues).toContainEqual(expect.objectContaining({ row: 3, field: "identifier" }));
  });

  it("reports non-empty rows missing required identifiers or names instead of silently skipping them", async () => {
    const payload = await parseMasterDataWorkbook(await workbookBytes([
      { type: "EMPLOYEE", identifier: "", fullName: "", department: "Operasional", position: "Staf" },
    ]));

    expect(payload.rows).toEqual([]);
    expect(payload.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, field: "identifier", message: "A value is required." }),
      expect.objectContaining({ row: 2, field: "fullName", message: "A value is required." }),
    ]));
  });

  it("rejects a workbook whose headers differ from the official template", async () => {
    await expect(parseMasterDataWorkbook(await workbookBytes([
      { type: "EMPLOYEE", identifier: "EMP-001", fullName: "Pegawai Sintetis", department: "Operasional", position: "Staf" },
    ], ["Type", ...masterDataColumns.slice(1)]))).rejects.toMatchObject({ code: "INVALID_IMPORT_HEADERS" });
  });
});
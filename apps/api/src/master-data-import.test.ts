import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { masterDataColumns, normalizeIdentifier, parseMasterDataWorkbook } from "./master-data-import.js";

async function workbookBytes(rows: Array<Record<string, string>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master Data");
  sheet.addRow([...masterDataColumns]);
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
});
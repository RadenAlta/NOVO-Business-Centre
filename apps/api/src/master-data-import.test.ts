import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { MASTER_DATA_INSTRUCTIONS_SHEET, MASTER_DATA_SHEET, createMasterDataTemplate, masterDataColumns, normalizeIdentifier, parseMasterDataWorkbook, toExcelJsBuffer } from "./master-data-import.js";

async function workbookBytes(rows: Array<Record<string, string>>, headers: readonly string[] = masterDataColumns): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(MASTER_DATA_SHEET);
  sheet.columns = masterDataColumns.map((key, index) => ({ header: headers[index] ?? "", key }));
  for (const row of rows) sheet.addRow(masterDataColumns.map((column) => row[column] ?? ""));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function workbookWithInstructions(configure: (master: ExcelJS.Worksheet, instructions: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const master = workbook.addWorksheet(MASTER_DATA_SHEET);
  master.columns = masterDataColumns.map((key) => ({ header: key, key }));
  master.addRow(["EMPLOYEE", "EMP-001", "Pegawai Sintetis", "", "", "", "", "Operasional", "Staf", "", ""]);
  const instructions = workbook.addWorksheet(MASTER_DATA_INSTRUCTIONS_SHEET);
  instructions.addRow(["Aturan", "Nilai aman"]);
  configure(master, instructions);
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

  it("rejects external worksheet hyperlinks and their relationship entries", async () => {
    const workbook = await workbookWithInstructions((master) => {
      master.getCell("C2").value = { text: "Pegawai Sintetis", hyperlink: "https://attacker.example/export" };
    });

    await expect(parseMasterDataWorkbook(workbook)).rejects.toMatchObject({ code: "UNSAFE_XLSX" });
  });

  it("rejects formulas outside the imported data region", async () => {
    const workbook = await workbookWithInstructions((_master, instructions) => {
      instructions.getCell("B2").value = { formula: "1+1", result: 2 };
    });

    await expect(parseMasterDataWorkbook(workbook)).rejects.toMatchObject({ code: "UNSAFE_XLSX" });
  });

  it("keeps synthetic examples out of the importable master sheet", async () => {
    const template = await createMasterDataTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toExcelJsBuffer(template));

    expect(workbook.getWorksheet(MASTER_DATA_SHEET)?.getRow(2).values).not.toContain("SYN-STU-001");
    expect(workbook.getWorksheet(MASTER_DATA_INSTRUCTIONS_SHEET)?.getCell("B12").text).toBe("SYN-STU-001");
    await expect(parseMasterDataWorkbook(template)).rejects.toMatchObject({ code: "IMPORT_EMPTY" });
  });

  it("rejects a workbook whose headers differ from the official template", async () => {
    await expect(parseMasterDataWorkbook(await workbookBytes([
      { type: "EMPLOYEE", identifier: "EMP-001", fullName: "Pegawai Sintetis", department: "Operasional", position: "Staf" },
    ], ["Type", ...masterDataColumns.slice(1)]))).rejects.toMatchObject({ code: "INVALID_IMPORT_HEADERS" });
  });
});
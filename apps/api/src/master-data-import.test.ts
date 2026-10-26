import { deflateRawSync } from "node:zlib";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { MASTER_DATA_INSTRUCTIONS_SHEET, MASTER_DATA_SHEET, MAX_ARCHIVE_EXPANDED_BYTES, assertNoExternalRelationships, createMasterDataTemplate, masterDataColumns, normalizeIdentifier, parseMasterDataWorkbook, toExcelJsBuffer } from "./master-data-import.js";

type ZipFixtureEntry = {
  name: string;
  content: Buffer;
  declaredUncompressedSize?: number;
};

function createZipFixture(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const filename = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content);
    const declaredUncompressedSize = entry.declaredUncompressedSize ?? entry.content.byteLength;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(declaredUncompressedSize, 22);
    localHeader.writeUInt16LE(filename.byteLength, 26);
    localParts.push(localHeader, filename, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(declaredUncompressedSize, 24);
    centralHeader.writeUInt16LE(filename.byteLength, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, filename);
    localOffset += localHeader.byteLength + filename.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.byteLength, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function minimumWorkbookArchive(entries: ZipFixtureEntry[] = []): Buffer {
  return createZipFixture([
    { name: "[Content_Types].xml", content: Buffer.from("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\" />") },
    { name: "xl/workbook.xml", content: Buffer.from("<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" />") },
    ...entries,
  ]);
}

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
  it("rejects falsified ZIP metadata before a compressed entry can exceed the expansion cap", async () => {
    const falsifiedArchive = minimumWorkbookArchive([
      {
        name: "xl/worksheets/sheet1.xml",
        content: Buffer.alloc(MAX_ARCHIVE_EXPANDED_BYTES + 1, 0x41),
        declaredUncompressedSize: 1,
      },
    ]);

    await expect(parseMasterDataWorkbook(falsifiedArchive)).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_TOO_LARGE" });
  });

  it("rejects oversized relationship XML before parsing it", async () => {
    const oversizedRelationship = Buffer.alloc(128 * 1024 + 1);
    let state = 0x12345678;
    for (let index = 0; index < oversizedRelationship.byteLength; index += 1) {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      oversizedRelationship[index] = state >>> 24;
    }
    const archive = minimumWorkbookArchive([{ name: "_rels/.rels", content: oversizedRelationship }]);

    await expect(parseMasterDataWorkbook(archive)).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_TOO_LARGE" });
  });

  it("rejects an encoded external TargetMode in a root package relationship", async () => {
    const archive = minimumWorkbookArchive([
      {
        name: "_rels/.rels",
        content: Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="urn:test" Target="https://attacker.example/export" TargetMode="Ex&#x74;ernal" /></Relationships>`),
      },
    ]);

    await expect(parseMasterDataWorkbook(archive)).rejects.toMatchObject({ code: "UNSAFE_XLSX" });
  });

  it("rejects relationship XML containing a document type declaration", async () => {
    const archive = minimumWorkbookArchive([
      {
        name: "_rels/.rels",
        content: Buffer.from(`<!DOCTYPE Relationships [<!ENTITY payload "expanded">]><Relationships><Relationship Id="rId1" Type="urn:test" Target="&payload;" /></Relationships>`),
      },
    ]);

    await expect(parseMasterDataWorkbook(archive)).rejects.toMatchObject({ code: "INVALID_XLSX" });
  });

  it("permits a safe internal package relationship", () => {
    expect(() => assertNoExternalRelationships(new Map([
      [
        "xl/_rels/workbook.xml.rels",
        Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="urn:test" Target="worksheets/sheet1.xml" TargetMode="Internal" /></Relationships>`),
      ],
    ]))).not.toThrow();
  });
});

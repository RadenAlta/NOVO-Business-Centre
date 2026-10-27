import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import ExcelJS from "exceljs";
import { SaxesParser } from "saxes";
import { z } from "zod";

import { HttpError } from "./lib.js";

export const MASTER_DATA_TEMPLATE_FILENAME = "novo-master-data-template.xlsx";
export const MASTER_DATA_SHEET = "Master Data";
export const MASTER_DATA_INSTRUCTIONS_SHEET = "Instructions";
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 10 * 1024 * 1024;
const MAX_RELATIONSHIP_XML_BYTES = 128 * 1024;
const MAX_RELATIONSHIP_COUNT = 100;

const identityTypes = ["STUDENT", "TEACHER", "EMPLOYEE"] as const;
type IdentityType = (typeof identityTypes)[number];

export const masterDataColumns = [
  "type",
  "identifier",
  "fullName",
  "barcode",
  "className",
  "grade",
  "schoolYear",
  "department",
  "position",
  "email",
  "phone",
] as const;

type MasterDataColumn = (typeof masterDataColumns)[number];

export const masterDataImportRowSchema = z.object({
  row: z.number().int().positive(),
  type: z.enum(identityTypes),
  identifier: z.string().min(2).max(80),
  fullName: z.string().min(2).max(160),
  barcode: z.string().min(2).max(80).optional(),
  className: z.string().min(1).max(80).optional(),
  grade: z.string().min(1).max(40).optional(),
  schoolYear: z.string().min(4).max(20).optional(),
  department: z.string().min(2).max(120).optional(),
  position: z.string().min(2).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(30).optional(),
});

export type MasterDataImportRow = z.infer<typeof masterDataImportRowSchema>;

export const importIssueSchema = z.object({
  row: z.number().int().positive(),
  field: z.string().min(1).max(40),
  message: z.string().min(1).max(240),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importPreviewPayloadSchema = z.object({
  rows: z.array(masterDataImportRowSchema).max(MAX_IMPORT_ROWS),
  issues: z.array(importIssueSchema).max(MAX_IMPORT_ROWS * masterDataColumns.length),
});
export type ImportPreviewPayload = z.infer<typeof importPreviewPayloadSchema>;

export type ExistingMasterDataRecord = {
  id: string;
  type: IdentityType;
  identifier: string;
  dataSource: string;
};

export type ImportAction = "create" | "update" | "skip" | "error";
export type ImportPreviewRow = {
  row: number;
  type?: IdentityType;
  identifier?: string;
  fullName?: string;
  action: ImportAction;
  reason?: string;
};

export type ImportSummary = {
  create: number;
  update: number;
  skip: number;
  error: number;
};

type ArchiveEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function importError(code: string, message: string, details?: unknown): HttpError {
  return new HttpError(400, code, message, details);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeIdentifier(value: string): string {
  return normalizeText(value).toUpperCase();
}

// ExcelJS 4.4.0 declares its load input as a legacy global Buffer interface.
// Copy into a standalone ArrayBuffer so Node 24's Buffer<ArrayBufferLike> is
// never passed through that incompatible declaration or backed by shared memory.
export function toExcelJsBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function safeOptional(value: string, max: number, field: string, row: number, issues: ImportIssue[], min = 1): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  if (/^[=+\-@]/.test(normalized)) {
    issues.push({ row, field, message: "Formula-like values are not allowed in imports." });
    return undefined;
  }
  if (normalized.length < min || normalized.length > max) {
    issues.push({ row, field, message: `Value must contain ${min}-${max} characters.` });
    return undefined;
  }
  return normalized;
}

function safeRequired(value: string, max: number, field: string, row: number, issues: ImportIssue[], min = 1): string | undefined {
  const normalized = safeOptional(value, max, field, row, issues, min);
  if (!normalized && !issues.some((issue) => issue.row === row && issue.field === field)) {
    issues.push({ row, field, message: "A value is required." });
  }
  return normalized;
}

function safeCellText(cell: ExcelJS.Cell, row: number, field: string, issues: ImportIssue[]): string {
  const value = cell.value;
  if (cell.type === ExcelJS.ValueType.Formula || (typeof value === "object" && value !== null && "formula" in value)) {
    issues.push({ row, field, message: "Spreadsheet formulas are not accepted as import data." });
    return "";
  }
  return normalizeText(cell.text ?? "");
}

function inspectXlsxArchive(bytes: Buffer): ArchiveEntry[] {
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw importError("INVALID_XLSX", "Upload a valid .xlsx workbook.");
  }
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw importError("IMPORT_FILE_TOO_LARGE", "Workbook must be 2 MiB or smaller.");
  }

  const minimum = Math.max(0, bytes.byteLength - 65_557);
  let endOfCentralDirectory = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0) throw importError("INVALID_XLSX", "Workbook ZIP directory is missing or corrupt.");

  const entries = bytes.readUInt16LE(endOfCentralDirectory + 10);
  const centralDirectorySize = bytes.readUInt32LE(endOfCentralDirectory + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(endOfCentralDirectory + 16);
  if (!entries || entries > 60 || centralDirectoryOffset + centralDirectorySize > endOfCentralDirectory) {
    throw importError("INVALID_XLSX", "Workbook has an unsafe archive structure.");
  }

  let cursor = centralDirectoryOffset;
  let totalUncompressed = 0;
  const names: string[] = [];
  const archiveEntries: ArchiveEntry[] = [];
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.byteLength || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw importError("INVALID_XLSX", "Workbook ZIP directory is corrupt.");
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const filenameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const filenameStart = cursor + 46;
    const filenameEnd = filenameStart + filenameLength;
    if (filenameEnd > bytes.byteLength || flags & 1 || compressedSize === 0 && uncompressedSize > 0) {
      throw importError("INVALID_XLSX", "Workbook contains an unsupported or encrypted archive entry.");
    }
    const name = bytes.subarray(filenameStart, filenameEnd).toString("utf8");
    if (!name || name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw importError("INVALID_XLSX", "Workbook contains an unsafe archive path.");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ARCHIVE_EXPANDED_BYTES || (compressedSize > 0 && uncompressedSize / compressedSize > 100)) {
      throw importError("IMPORT_ARCHIVE_TOO_LARGE", "Workbook expands beyond the safe import limit.");
    }
    const normalizedName = name.toLowerCase();
    names.push(normalizedName);
    archiveEntries.push({ name: normalizedName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    cursor = filenameEnd + extraLength + commentLength;
  }

  if (!names.includes("[content_types].xml") || !names.includes("xl/workbook.xml") || names.some((name) => name.includes("vbaproject") || name.includes("externallink"))) {
    throw importError("UNSAFE_XLSX", "Macro-enabled or externally linked workbooks are not accepted.");
  }
  return archiveEntries;
}

function readArchiveEntry(bytes: Buffer, entry: ArchiveEntry, maximumOutputBytes: number): Buffer {
  const headerOffset = entry.localHeaderOffset;
  if (headerOffset + 30 > bytes.byteLength || bytes.readUInt32LE(headerOffset) !== 0x04034b50) {
    throw importError("INVALID_XLSX", "Workbook ZIP local entry is corrupt.");
  }
  const filenameLength = bytes.readUInt16LE(headerOffset + 26);
  const extraLength = bytes.readUInt16LE(headerOffset + 28);
  const dataStart = headerOffset + 30 + filenameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) throw importError("INVALID_XLSX", "Workbook ZIP entry data is corrupt.");
  if (entry.uncompressedSize > maximumOutputBytes) {
    throw importError("IMPORT_ARCHIVE_TOO_LARGE", "Workbook expands beyond the safe import limit.");
  }

  let content: Buffer;
  try {
    if (entry.compressionMethod === 0) content = bytes.subarray(dataStart, dataEnd);
    else if (entry.compressionMethod === 8) content = Buffer.from(inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: maximumOutputBytes }));
    else throw new Error("Unsupported ZIP compression method.");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ERR_BUFFER_TOO_LARGE") {
      throw importError("IMPORT_ARCHIVE_TOO_LARGE", "Workbook expands beyond the safe import limit.");
    }
    throw importError("INVALID_XLSX", "Workbook ZIP entry cannot be safely read.");
  }
  if (content.byteLength > maximumOutputBytes) {
    throw importError("IMPORT_ARCHIVE_TOO_LARGE", "Workbook expands beyond the safe import limit.");
  }
  if (content.byteLength !== entry.uncompressedSize) {
    throw importError("INVALID_XLSX", "Workbook ZIP entry size is inconsistent.");
  }
  return content;
}

function validateArchiveContents(bytes: Buffer, entries: ArchiveEntry[]): ReadonlyMap<string, Buffer> {
  let totalActualBytes = 0;
  const relationshipFiles = new Map<string, Buffer>();
  for (const entry of entries) {
    const remainingBytes = MAX_ARCHIVE_EXPANDED_BYTES - totalActualBytes;
    const content = readArchiveEntry(bytes, entry, Math.max(1, remainingBytes));
    totalActualBytes += content.byteLength;
    if (totalActualBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw importError("IMPORT_ARCHIVE_TOO_LARGE", "Workbook expands beyond the safe import limit.");
    }
    if (entry.name.endsWith(".rels")) relationshipFiles.set(entry.name, content);
  }
  return relationshipFiles;
}

export function assertNoExternalRelationships(relationshipFiles: ReadonlyMap<string, Buffer>): void {
  for (const [name, relationshipXml] of relationshipFiles) {
    if (relationshipXml.byteLength > MAX_RELATIONSHIP_XML_BYTES) {
      throw importError("IMPORT_ARCHIVE_TOO_LARGE", `Relationship XML '${name}' exceeds the safe size limit.`);
    }

    let relationshipCount = 0;
    let externalRelationship = false;
    const parser = new SaxesParser({ xmlns: false });
    parser.on("doctype", () => {
      throw new Error("DOCTYPE declarations are not allowed.");
    });
    parser.on("error", (error) => {
      throw error;
    });
    parser.on("opentag", (tag) => {
      if (tag.name !== "Relationships" && tag.name !== "Relationship") {
        throw new Error("Unexpected relationship XML element.");
      }
      if (tag.name !== "Relationship") return;
      relationshipCount += 1;
      if (relationshipCount > MAX_RELATIONSHIP_COUNT) {
        throw new Error("Too many relationship entries.");
      }
      const targetMode = tag.attributes.TargetMode;
      if (typeof targetMode === "string" && targetMode.trim().toLowerCase() === "external") {
        externalRelationship = true;
      }
    });

    try {
      parser.write(relationshipXml.toString("utf8")).close();
    } catch {
      throw importError("INVALID_XLSX", "Workbook relationship XML is invalid or unsafe.");
    }
    if (externalRelationship) {
      throw importError("UNSAFE_XLSX", "Workbook external relationships are not accepted.");
    }
  }
}

function assertWorkbookCellPolicy(workbook: ExcelJS.Workbook): void {
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (cell.type === ExcelJS.ValueType.Formula || (typeof value === "object" && value !== null && "formula" in value)) {
          throw importError("UNSAFE_XLSX", "Workbook formulas are not accepted anywhere in the template.");
        }
        if (typeof value === "object" && value !== null && "hyperlink" in value && typeof value.hyperlink === "string" && !value.hyperlink.startsWith("#")) {
          throw importError("UNSAFE_XLSX", "Workbook external hyperlinks are not accepted.");
        }
      });
    });
  }
}

function assertExpectedHeaders(sheet: ExcelJS.Worksheet): void {
  const headerIssues: ImportIssue[] = [];
  const headers = masterDataColumns.map((column, index) => safeCellText(sheet.getRow(1).getCell(index + 1), 1, column, headerIssues));
  if (headerIssues.length || sheet.getRow(1).actualCellCount !== masterDataColumns.length || headers.some((header, index) => header !== masterDataColumns[index])) {
    throw importError("INVALID_IMPORT_HEADERS", "Workbook headers must exactly match the NOVO Master Data template.", { expected: masterDataColumns });
  }
}

function rowFromWorksheet(row: ExcelJS.Row, rowNumber: number, issues: ImportIssue[]): MasterDataImportRow | undefined {
  const values = Object.fromEntries(masterDataColumns.map((column, index) => [column, safeCellText(row.getCell(index + 1), rowNumber, column, issues)])) as Record<MasterDataColumn, string>;
  if (masterDataColumns.every((column) => !values[column])) return undefined;

  const type = values.type.toUpperCase();
  if (!identityTypes.includes(type as IdentityType)) issues.push({ row: rowNumber, field: "type", message: "Type must be STUDENT, TEACHER, or EMPLOYEE." });
  const identifier = safeRequired(values.identifier, 80, "identifier", rowNumber, issues, 2);
  const fullName = safeRequired(values.fullName, 160, "fullName", rowNumber, issues, 2);
  const barcode = safeOptional(values.barcode, 80, "barcode", rowNumber, issues, 2);
  const className = safeOptional(values.className, 80, "className", rowNumber, issues);
  const grade = safeOptional(values.grade, 40, "grade", rowNumber, issues);
  const schoolYear = safeOptional(values.schoolYear, 20, "schoolYear", rowNumber, issues, 4);
  const department = safeOptional(values.department, 120, "department", rowNumber, issues, 2);
  const position = safeOptional(values.position, 120, "position", rowNumber, issues, 2);
  const email = safeOptional(values.email, 254, "email", rowNumber, issues);
  const phone = safeOptional(values.phone, 30, "phone", rowNumber, issues, 6);

  if (email && !z.string().email().safeParse(email).success) issues.push({ row: rowNumber, field: "email", message: "Email address is invalid." });
  const isStudent = type === "STUDENT";
  if (isStudent && (department || position)) issues.push({ row: rowNumber, field: "type", message: "Student rows cannot set department or position." });
  if (!isStudent && (className || grade || schoolYear)) issues.push({ row: rowNumber, field: "type", message: "Teacher and employee rows cannot set class, grade, or school year." });

  if (!identityTypes.includes(type as IdentityType) || !identifier || !fullName || issues.some((issue) => issue.row === rowNumber)) return undefined;
  return {
    row: rowNumber,
    type: type as IdentityType,
    identifier: normalizeIdentifier(identifier),
    fullName,
    ...(barcode ? { barcode: normalizeIdentifier(barcode) } : {}),
    ...(isStudent ? { className, grade, schoolYear } : { department, position }),
    ...(email ? { email: email.toLowerCase() } : {}),
    ...(phone ? { phone } : {}),
  };
}

export async function parseMasterDataWorkbook(bytes: Buffer): Promise<ImportPreviewPayload> {
  const archiveEntries = inspectXlsxArchive(bytes);
  const relationshipFiles = validateArchiveContents(bytes, archiveEntries);
  assertNoExternalRelationships(relationshipFiles);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(toExcelJsBuffer(bytes));
  } catch {
    throw importError("INVALID_XLSX", "Workbook cannot be read as a valid .xlsx file.");
  }

  const allowedSheets = new Set([MASTER_DATA_SHEET, MASTER_DATA_INSTRUCTIONS_SHEET]);
  if (!workbook.worksheets.length || workbook.worksheets.some((sheet) => !allowedSheets.has(sheet.name))) {
    throw importError("INVALID_IMPORT_SHEET", `Workbook may contain only the '${MASTER_DATA_SHEET}' sheet and optional '${MASTER_DATA_INSTRUCTIONS_SHEET}' sheet.`);
  }
  assertWorkbookCellPolicy(workbook);
  const sheet = workbook.getWorksheet(MASTER_DATA_SHEET);
  if (!sheet) throw importError("INVALID_IMPORT_SHEET", `Workbook must contain a '${MASTER_DATA_SHEET}' sheet.`);
  assertExpectedHeaders(sheet);
  if (sheet.actualRowCount - 1 > MAX_IMPORT_ROWS) throw importError("IMPORT_TOO_MANY_ROWS", `Workbook may contain at most ${MAX_IMPORT_ROWS} data rows.`);

  const rows: MasterDataImportRow[] = [];
  const issues: ImportIssue[] = [];
  sheet.eachRow({ includeEmpty: false }, (sheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const parsed = rowFromWorksheet(sheetRow, rowNumber, issues);
    if (parsed) rows.push(parsed);
  });
  if (!rows.length && !issues.length) throw importError("IMPORT_EMPTY", "Workbook does not contain any Master Data rows.");

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.type}:${row.identifier}`;
    const firstRow = seen.get(key);
    if (firstRow) issues.push({ row: row.row, field: "identifier", message: `Duplicates row ${firstRow} for the same type and identifier.` });
    else seen.set(key, row.row);
  }
  return { rows, issues };
}

export function fingerprintImportPreview(payload: ImportPreviewPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function classifyImportPreview(payload: ImportPreviewPayload, existingRecords: ExistingMasterDataRecord[]): { rows: ImportPreviewRow[]; summary: ImportSummary } {
  const existingByKey = new Map(existingRecords.map((record) => [`${record.type}:${record.identifier}`, record]));
  const invalidRows = new Set(payload.issues.map((issue) => issue.row));
  const rows: ImportPreviewRow[] = [];
  const summary: ImportSummary = { create: 0, update: 0, skip: 0, error: invalidRows.size };

  for (const row of payload.rows) {
    if (invalidRows.has(row.row)) continue;
    const existing = existingByKey.get(`${row.type}:${row.identifier}`);
    if (!existing) {
      rows.push({ row: row.row, type: row.type, identifier: row.identifier, fullName: row.fullName, action: "create" });
      summary.create += 1;
    } else if (existing.dataSource === "SIMS") {
      rows.push({ row: row.row, type: row.type, identifier: row.identifier, fullName: row.fullName, action: "skip", reason: "SIMS-managed records cannot be overwritten by manual imports." });
      summary.skip += 1;
    } else {
      rows.push({ row: row.row, type: row.type, identifier: row.identifier, fullName: row.fullName, action: "update" });
      summary.update += 1;
    }
  }
  for (const row of invalidRows) rows.push({ row, action: "error", reason: "Fix the row issues before committing this preview." });
  rows.sort((left, right) => left.row - right.row);
  return { rows, summary };
}

function templateValue(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function createMasterDataTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NOVO Business Centre";
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const sheet = workbook.addWorksheet(MASTER_DATA_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = masterDataColumns.map((key) => ({ header: key, key, width: Math.max(14, key.length + 4) }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176247" } };
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + masterDataColumns.length)}1` };
  for (let row = 2; row <= MAX_IMPORT_ROWS + 1; row += 1) {
    sheet.getCell(`A${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"STUDENT,TEACHER,EMPLOYEE"'] };
  }

  const examples: Array<Record<MasterDataColumn, string>> = [
    { type: "STUDENT", identifier: "SYN-STU-001", fullName: "Siswa Sintetis Satu", barcode: "CARD-SYN-001", className: "7-A", grade: "7", schoolYear: "2026/2027", department: "", position: "", email: "", phone: "" },
    { type: "TEACHER", identifier: "SYN-TCH-001", fullName: "Guru Sintetis Satu", barcode: "CARD-SYN-002", className: "", grade: "", schoolYear: "", department: "Akademik", position: "Guru Matematika", email: "guru.sintetis@example.test", phone: "628000000001" },
    { type: "EMPLOYEE", identifier: "SYN-EMP-001", fullName: "Pegawai Sintetis Satu", barcode: "CARD-SYN-003", className: "", grade: "", schoolYear: "", department: "Operasional", position: "Staf Koperasi", email: "pegawai.sintetis@example.test", phone: "628000000002" },
  ];
  const instructions = workbook.addWorksheet(MASTER_DATA_INSTRUCTIONS_SHEET);
  instructions.getColumn(1).width = 32;
  instructions.getColumn(2).width = 100;
  instructions.addRow(["Aturan", "Petunjuk"]);
  [
    ["Kunci", "Gunakan gabungan type + identifier sebagai kunci unik di tenant Anda."],
    ["Jenis", "Nilai type hanya STUDENT, TEACHER, atau EMPLOYEE."],
    ["Siswa", "Isi className, grade, dan schoolYear bila tersedia. Jangan isi department atau position."],
    ["Guru/Pegawai", "Isi department dan position bila tersedia. Jangan isi className, grade, atau schoolYear."],
    ["Keamanan", "Jangan masukkan formula, macro, external link, atau data nyata saat pengujian."],
    ["SIMS", "Baris yang cocok dengan record kelolaan SIMS akan dilewati, bukan ditimpa."],
    ["Proses", "Unggah untuk preview, perbaiki semua error, lalu konfirmasi commit. Preview tidak menulis data."],
  ].forEach((row) => instructions.addRow(row));
  instructions.getRow(1).font = { bold: true };
  instructions.addRow([]);
  instructions.addRow(["Contoh sintetis", "Contoh ini berada di sheet Instructions dan tidak dapat diimpor langsung."]);
  const exampleHeader = instructions.addRow([...masterDataColumns]);
  exampleHeader.font = { bold: true };
  examples.forEach((example) => instructions.addRow(masterDataColumns.map((column) => templateValue(example[column]))));

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}
import type { UserRole } from "./roles.js";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import multer from "multer";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";

import { Prisma, type StockMovement } from "@prisma/client";
import { z } from "zod";
import { audit } from "./audit.js";
import { authenticate, clearSessionCookie, createBrowserSession, requireCsrf, requireRoles, requireTrustedOrigin, issueCsrfToken, revokeSessionForLogout, setSessionCookie } from "./auth.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { asNumber, asyncRoute, HttpError, makeReference } from "./lib.js";
import { storeSkuInput } from "./store-sku.js";
import { fingerprintInventoryMutation, inventoryIdempotencyKeySchema } from "./store-inventory-idempotency.js";
import { withSerializableTransactionRetry, withStoreTransactionRetry } from "./store-transaction.js";
import { inclusiveActiveDays, jakartaMonth, jakartaPeriodDays, jakartaPeriodLabel, proratedRupiah, shuttleRupiahBigInt, shuttleRupiahNumber, sumShuttleRupiah } from "./shuttle-billing.js";
import { isActiveShuttleSubscriptionUniqueConflict } from "./shuttle-subscription-unique.js";
import { isPaymentReferenceUniqueConflict } from "./shuttle-payment-reference-unique.js";
import { MAX_IMPORT_FILE_BYTES, IMPORT_PREVIEW_TTL_MS, MASTER_DATA_TEMPLATE_FILENAME, classifyImportPreview, createMasterDataTemplate, fingerprintImportPreview, importPreviewPayloadSchema, normalizeIdentifier, parseMasterDataWorkbook, type ExistingMasterDataRecord } from "./master-data-import.js";
import type { AuthContext, AuthenticatedRequest } from "./types.js";
import { date, id, memberInput, money, paymentMethod } from "./validation.js";

const app = express();
const api = express.Router();
const writeRoles: UserRole[] = [
  "OWNER",
  "ADMIN",
  "CASHIER",
  "FLEET_MANAGER",
  "CATERING_MANAGER",
  "FINANCE_OFFICER",
  "PROCUREMENT_OFFICER",
];
const adminRoles: UserRole[] = ["OWNER", "ADMIN"];
const uploadDir = path.resolve(env.UPLOAD_DIR);
mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    callback(null, allowed.includes(file.mimetype));
  },
});

const masterDataImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    const hasXlsxExtension = file.originalname.toLowerCase().endsWith(".xlsx");
    const hasXlsxMime = file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    callback(null, hasXlsxExtension && hasXlsxMime);
  },
});

const me = (request: Request): AuthContext => (request as AuthenticatedRequest).auth;
const decimalJson = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) =>
  typeof item === "object" && item !== null && "toNumber" in item ? (item as { toNumber(): number }).toNumber() : item,
)) as T;
const auditSnapshot = (value: unknown): Prisma.InputJsonValue => decimalJson(value) as Prisma.InputJsonValue;

/**
 * Shuttle money is persisted as Decimal for database precision, but its public
 * API contract is a whole-Rupiah JSON number. Do this only at the response
 * boundary, after all settlement arithmetic and persistence have completed.
 */
const shuttleSettlementJson = <T extends {
  verifiedAmount: { toString(): string };
  vendorAmount: { toString(): string };
  cooperativeAmount: { toString(): string };
}>(settlement: T) => ({
  ...decimalJson(settlement),
  verifiedAmount: shuttleRupiahNumber(shuttleRupiahBigInt(settlement.verifiedAmount, "INVALID_SETTLEMENT_AMOUNT"), "INVALID_SETTLEMENT_AMOUNT"),
  vendorAmount: shuttleRupiahNumber(shuttleRupiahBigInt(settlement.vendorAmount, "INVALID_SETTLEMENT_AMOUNT"), "INVALID_SETTLEMENT_AMOUNT"),
  cooperativeAmount: shuttleRupiahNumber(shuttleRupiahBigInt(settlement.cooperativeAmount, "INVALID_SETTLEMENT_AMOUNT"), "INVALID_SETTLEMENT_AMOUNT"),
});

const shuttleCollectibleInvoiceQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

const activityCategory = z.enum(["INVENTORY", "SALES", "SERVICE", "ADMINISTRATION"]);
const activityClassificationInput = z.object({
  noteDeidentified: z.string().trim().min(3).max(500),
}).strict();
const activityClassificationProviderResponse = z.object({
  predicted_category: activityCategory,
  confidence: z.number().finite().min(0).max(1).nullable(),
  decision_score: z.number().finite().nullable(),
  model_version: z.string().trim().min(1).max(160),
  label_version: z.string().trim().min(1).max(160),
  inference_status: z.literal("ok"),
}).strict().superRefine((value, context) => {
  if ((value.confidence === null) === (value.decision_score === null)) {
    context.addIssue({ code: "custom", message: "Provider must return exactly one score type." });
  }
});
const activityClassificationRoles: UserRole[] = ["OWNER", "ADMIN", "ANALYST"];

const sqlLikeLiteral = (value: string) => value.replace(/[!%_]/g, "!$&");

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "X-Novo-Csrf", "Idempotency-Key"], maxAge: 600 }));
app.use(express.json({ limit: "1mb" }));


app.get("/healthz", (_request, response) => response.json({ status: "ok" }));

api.get("/healthz", (_request, response) => response.json({ status: "ok", service: "novo-api" }));

api.post("/auth/bootstrap", requireTrustedOrigin, asyncRoute(async (request, response) => {
  const input = z.object({
    tenantName: z.string().trim().min(2).max(120),
    slug: z.string().trim().regex(/^[a-z0-9-]{3,50}$/),
    ownerName: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(12).max(128),
  }).parse(request.body);
  if (await prisma.tenant.count()) throw new HttpError(409, "BOOTSTRAP_COMPLETE", "The workspace has already been initialized.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const tenant = await prisma.tenant.create({
    data: {
      name: input.tenantName,
      slug: input.slug,
      users: { create: { name: input.ownerName, email: input.email.toLowerCase(), passwordHash, role: "SUPER_ADMIN" } },
    },
    include: { users: true },
  });
  const user = tenant.users[0];
  if (!user) throw new HttpError(500, "BOOTSTRAP_FAILED", "Owner account could not be created.");
  const auth = { id: user.id, tenantId: tenant.id, email: user.email, name: user.name, role: user.role } as AuthContext;
  await audit(auth, "bootstrap", "Tenant", tenant.id, { slug: tenant.slug });
  const session = await createBrowserSession(auth);
  setSessionCookie(response, session.token);
  response.status(201).json({ user: auth, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, csrfToken: session.csrfToken });
}));

api.post("/auth/login", requireTrustedOrigin, asyncRoute(async (request, response) => {
  const input = z.object({ tenantSlug: z.string().trim().min(3), email: z.string().email(), password: z.string().min(1) }).parse(request.body);
  const user = await prisma.user.findFirst({ where: { email: input.email.toLowerCase(), active: true, tenant: { slug: input.tenantSlug } }, include: { tenant: true } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email, password, or workspace is incorrect.");
  }
  const auth = { id: user.id, tenantId: user.tenantId, email: user.email, name: user.name, role: user.role } as AuthContext;
  const session = await createBrowserSession(auth);
  setSessionCookie(response, session.token);
  response.json({ user: auth, tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug }, csrfToken: session.csrfToken });
}));

api.post("/auth/logout", requireTrustedOrigin, asyncRoute(async (request, response) => {
  await revokeSessionForLogout(request);
  clearSessionCookie(response);
  response.status(204).end();
}));

api.use(authenticate);
api.use(requireCsrf);

api.get("/me", asyncRoute(async (request, response) => {
  const auth = me(request);
  const user = await prisma.user.findFirst({ where: { id: auth.id, tenantId: auth.tenantId, active: true }, select: { id: true, email: true, name: true, role: true, tenant: { select: { id: true, name: true, slug: true } } } });
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Your account is no longer available.");
  const csrfToken = await issueCsrfToken((request as AuthenticatedRequest).session.id);
  response.json({ user: { ...user, tenantId: auth.tenantId }, tenant: user.tenant, csrfToken });
}));

const masterDataType = z.enum(["STUDENT", "TEACHER", "EMPLOYEE"]);
const optionalMasterText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum).nullable().optional();
const masterDataCreateInput = z.object({
  type: masterDataType,
  identifier: z.string().trim().min(2).max(80),
  barcode: optionalMasterText(2, 80),
  fullName: z.string().trim().min(2).max(160),
  className: optionalMasterText(1, 80),
  grade: optionalMasterText(1, 40),
  schoolYear: optionalMasterText(4, 20),
  department: optionalMasterText(2, 120),
  position: optionalMasterText(2, 120),
  email: z.string().trim().email().nullable().optional(),
  phone: optionalMasterText(6, 30),
}).strict();
const masterDataPatchInput = masterDataCreateInput.partial().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
const masterDataListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  type: masterDataType.optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const masterDataImportCommitInput = z.object({
  previewId: id,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const memberEligibleIdentityQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
type MasterDataType = z.infer<typeof masterDataType>;
type MasterDataCreateInput = z.infer<typeof masterDataCreateInput>;
type MasterDataPatchInput = z.infer<typeof masterDataPatchInput>;

function normalizeMasterDataFields(input: MasterDataCreateInput | MasterDataPatchInput, effectiveType: MasterDataType, clearIncompatible = false) {
  if (effectiveType === "STUDENT" && (input.department !== undefined || input.position !== undefined)) {
    throw new HttpError(400, "INVALID_MASTER_DATA", "Student identities cannot have a department or position.");
  }
  if (effectiveType !== "STUDENT" && (input.className !== undefined || input.grade !== undefined || input.schoolYear !== undefined)) {
    throw new HttpError(400, "INVALID_MASTER_DATA", "Teacher and employee identities cannot have student class fields.");
  }
  const common = {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.identifier !== undefined ? { identifier: normalizeIdentifier(input.identifier) } : {}),
    ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
    ...(input.barcode !== undefined ? { barcode: input.barcode ? normalizeIdentifier(input.barcode) : null } : {}),
    ...(input.email !== undefined ? { email: input.email ? input.email.toLowerCase() : null } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
  };
  if (effectiveType === "STUDENT") {
    return {
      ...common,
      ...(input.className !== undefined ? { className: input.className } : {}),
      ...(input.grade !== undefined ? { grade: input.grade } : {}),
      ...(input.schoolYear !== undefined ? { schoolYear: input.schoolYear } : {}),
      ...(clearIncompatible ? { department: null, position: null } : {}),
    };
  }
  return {
    ...common,
    ...(input.department !== undefined ? { department: input.department } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(clearIncompatible ? { className: null, grade: null, schoolYear: null } : {}),
  };
}

function masterDataAuditRecord(record: { type: string; identifier: string; active: boolean; dataSource: string }) {
  return { type: record.type, identifier: record.identifier, active: record.active, dataSource: record.dataSource };
}

function importRecordKey(record: { type: string; identifier: string }): string {
  return `${record.type}:${record.identifier}`;
}

async function requireEligibleCooperativeMember(memberId: string, tenantId: string) {
  const member = await prisma.cooperativeMember.findFirst({ where: { id: memberId, tenantId }, include: { identity: { select: { id: true, type: true, active: true } } } });
  if (!member) throw new HttpError(404, "NOT_FOUND", "Member not found.");
  if (!member.active || !member.identity || !member.identity.active || member.identity.type === "STUDENT") {
    throw new HttpError(400, "INELIGIBLE_COOPERATIVE_MEMBER", "An active teacher or employee identity is required for new cooperative-benefit operations.");
  }
  return member;
}

api.get("/master-data", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const query = masterDataListQuery.parse(request.query);
  const tenantId = me(request).tenantId;
  const where = {
    tenantId,
    ...(query.type ? { type: query.type } : {}),
    ...(query.active ? { active: query.active === "true" } : {}),
    ...(query.q ? { OR: [{ fullName: { contains: query.q, mode: "insensitive" as const } }, { identifier: { contains: query.q, mode: "insensitive" as const } }, { barcode: { contains: query.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, records] = await prisma.$transaction([
    prisma.masterDataRecord.count({ where }),
    prisma.masterDataRecord.findMany({ where, orderBy: [{ type: "asc" }, { fullName: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  response.json({ data: records, pagination: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } });
}));

api.get("/master-data/member-eligible", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const query = memberEligibleIdentityQuery.parse(request.query);
  const where = {
    tenantId: me(request).tenantId,
    active: true,
    type: { in: ["TEACHER", "EMPLOYEE"] as MasterDataType[] },
    ...(query.q ? { OR: [{ fullName: { contains: query.q, mode: "insensitive" as const } }, { identifier: { contains: query.q, mode: "insensitive" as const } }, { department: { contains: query.q, mode: "insensitive" as const } }, { position: { contains: query.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, records] = await prisma.$transaction([
    prisma.masterDataRecord.count({ where }),
    prisma.masterDataRecord.findMany({ where, select: { id: true, type: true, identifier: true, fullName: true, department: true, position: true, active: true }, orderBy: [{ fullName: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  response.json({ data: records, pagination: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } });
}));

api.post("/master-data", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const input = masterDataCreateInput.parse(request.body);
  const data = normalizeMasterDataFields(input, input.type);
  const record = await prisma.masterDataRecord.create({ data: { tenantId: me(request).tenantId, dataSource: "MANUAL", ...data, type: input.type, identifier: normalizeIdentifier(input.identifier), fullName: input.fullName } });
  await audit(me(request), "create", "MasterDataRecord", record.id, masterDataAuditRecord(record));
  response.status(201).json(record);
}));

api.patch("/master-data/:id", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const recordId = id.parse(request.params.id);
  const input = masterDataPatchInput.parse(request.body);
  const existing = await prisma.masterDataRecord.findFirst({ where: { id: recordId, tenantId: me(request).tenantId } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Master data record not found.");
  if (existing.dataSource === "SIMS") throw new HttpError(409, "SIMS_MANAGED_RECORD", "SIMS-managed identity fields cannot be edited manually.");
  const nextType = input.type ?? existing.type;
  const record = await prisma.masterDataRecord.update({ where: { id: recordId }, data: normalizeMasterDataFields(input, nextType, input.type !== undefined && input.type !== existing.type) });
  await audit(me(request), "update", "MasterDataRecord", record.id, { before: masterDataAuditRecord(existing), after: masterDataAuditRecord(record) });
  response.json(record);
}));

api.patch("/master-data/:id/active", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const recordId = id.parse(request.params.id);
  const input = z.object({ active: z.boolean() }).strict().parse(request.body);
  const existing = await prisma.masterDataRecord.findFirst({ where: { id: recordId, tenantId: me(request).tenantId } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Master data record not found.");
  if (existing.dataSource === "SIMS") throw new HttpError(409, "SIMS_MANAGED_RECORD", "SIMS-managed activation status cannot be changed manually.");
  await prisma.masterDataRecord.update({ where: { id: existing.id }, data: input });
  await audit(me(request), input.active ? "activate" : "deactivate", "MasterDataRecord", recordId, input);
  response.status(204).end();
}));

api.get("/master-data/imports/template", requireRoles(...adminRoles), asyncRoute(async (_request, response) => {
  const workbook = await createMasterDataTemplate();
  response.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.attachment(MASTER_DATA_TEMPLATE_FILENAME).send(workbook);
}));

api.post("/master-data/imports/preview", requireRoles(...adminRoles), masterDataImportUpload.single("file"), asyncRoute(async (request, response) => {
  if (!request.file) throw new HttpError(400, "XLSX_REQUIRED", "Upload one .xlsx workbook created from the NOVO template.");
  const payload = await parseMasterDataWorkbook(request.file.buffer);
  const tenantId = me(request).tenantId;
  const existingRecords: ExistingMasterDataRecord[] = payload.rows.length ? await prisma.masterDataRecord.findMany({
    where: { tenantId, OR: payload.rows.map((row) => ({ type: row.type, identifier: row.identifier })) },
    select: { id: true, type: true, identifier: true, dataSource: true },
  }) : [];
  const classification = classifyImportPreview(payload, existingRecords);
  const fingerprint = fingerprintImportPreview(payload);
  const expiresAt = new Date(Date.now() + IMPORT_PREVIEW_TTL_MS);
  await prisma.masterDataImportPreview.deleteMany({ where: { tenantId, createdById: me(request).id, expiresAt: { lt: new Date() } } });
  const preview = await prisma.masterDataImportPreview.create({ data: { tenantId, createdById: me(request).id, fingerprint, payload: payload as unknown as Prisma.InputJsonValue, expiresAt } });
  await audit(me(request), "preview_import", "MasterDataImportPreview", preview.id, { summary: classification.summary, source: "XLSX" });
  response.status(201).json({ previewId: preview.id, fingerprint, expiresAt, summary: classification.summary, rows: classification.rows, issues: payload.issues });
}));

api.post("/master-data/imports/commit", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const input = masterDataImportCommitInput.parse(request.body);
  const actor = me(request);
  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const preview = await tx.masterDataImportPreview.findFirst({ where: { id: input.previewId, tenantId: actor.tenantId, createdById: actor.id, fingerprint: input.fingerprint, expiresAt: { gt: now }, consumedAt: null } });
    if (!preview) throw new HttpError(409, "IMPORT_PREVIEW_INVALID", "Preview is expired, altered, or already committed. Create a new preview.");
    const claimed = await tx.masterDataImportPreview.updateMany({ where: { id: preview.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (claimed.count !== 1) throw new HttpError(409, "IMPORT_PREVIEW_ALREADY_USED", "This preview was already committed. Refresh the Master Data list.");

    const payload = importPreviewPayloadSchema.parse(preview.payload);
    if (payload.issues.length) throw new HttpError(422, "IMPORT_PREVIEW_HAS_ERRORS", "Fix every preview error before committing the import.", { issues: payload.issues });
    const existingRecords: ExistingMasterDataRecord[] = payload.rows.length ? await tx.masterDataRecord.findMany({
      where: { tenantId: actor.tenantId, OR: payload.rows.map((row) => ({ type: row.type, identifier: row.identifier })) },
      select: { id: true, type: true, identifier: true, dataSource: true },
    }) : [];
    const classification = classifyImportPreview(payload, existingRecords);
    const existingByKey = new Map(existingRecords.map((record) => [importRecordKey(record), record]));
    for (const row of payload.rows) {
      const existing = existingByKey.get(importRecordKey(row));
      if (existing?.dataSource === "SIMS") continue;
      const data = {
        fullName: row.fullName,
        barcode: row.barcode ?? null,
        className: row.className ?? null,
        grade: row.grade ?? null,
        schoolYear: row.schoolYear ?? null,
        department: row.department ?? null,
        position: row.position ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
      };
      if (existing) await tx.masterDataRecord.update({ where: { id: existing.id }, data });
      else await tx.masterDataRecord.create({ data: { tenantId: actor.tenantId, type: row.type, identifier: row.identifier, dataSource: "MANUAL", ...data } });
    }
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "commit_import", entityType: "MasterDataImportPreview", entityId: preview.id, after: { summary: classification.summary, source: "XLSX" } as unknown as Prisma.InputJsonValue } });
    return classification.summary;
  }, { isolationLevel: "Serializable", timeout: 10_000 });
  response.json({ summary: result });
}));

const memberReadRoles: UserRole[] = [...writeRoles, "ANALYST"];
api.get("/members", requireRoles(...memberReadRoles), asyncRoute(async (request, response) => {
  const query = z.object({ q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(request.query);
  const where = { tenantId: me(request).tenantId, ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" as const } }, { memberNo: { contains: query.q, mode: "insensitive" as const } }] } : {}) };
  const [total, members] = await prisma.$transaction([
    prisma.cooperativeMember.count({ where }),
    prisma.cooperativeMember.findMany({ where, include: { identity: { select: { id: true, type: true, identifier: true, fullName: true, active: true } } }, orderBy: { name: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  response.json({ data: members.map((member) => ({ ...member, eligible: Boolean(member.identity && member.identity.active && member.identity.type !== "STUDENT") })), pagination: { page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) } });
}));

api.post("/members", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const input = memberInput.parse(request.body);
  const actor = me(request);
  const member = await prisma.$transaction(async (tx) => {
    const identity = await tx.masterDataRecord.findFirst({ where: { id: input.identityId, tenantId: actor.tenantId }, select: { id: true, type: true, active: true, fullName: true, email: true, phone: true } });
    if (!identity || identity.type === "STUDENT" || !identity.active) {
      throw new HttpError(400, "INELIGIBLE_MEMBER_IDENTITY", "Only an active teacher or employee identity from this tenant may become a cooperative member.");
    }
    const created = await tx.cooperativeMember.create({ data: { tenantId: actor.tenantId, identityId: identity.id, memberNo: normalizeIdentifier(input.memberNo), name: identity.fullName, email: identity.email, phone: identity.phone } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "CooperativeMember", entityId: created.id, after: { memberNo: created.memberNo, identityId: created.identityId, active: created.active } as unknown as Prisma.InputJsonValue } });
    return created;
  });
  response.status(201).json(member);
}));

api.patch("/members/:id/active", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const memberId = id.parse(request.params.id);
  const input = z.object({ active: z.boolean() }).strict().parse(request.body);
  const actor = me(request);
  await prisma.$transaction(async (tx) => {
    const member = await tx.cooperativeMember.findFirst({
      where: { id: memberId, tenantId: actor.tenantId },
      include: { identity: { select: { id: true, type: true, active: true } } },
    });
    if (!member) throw new HttpError(404, "NOT_FOUND", "Cooperative member not found.");
    if (input.active && (!member.identity || !member.identity.active || member.identity.type === "STUDENT")) {
      throw new HttpError(400, "INELIGIBLE_MEMBER_IDENTITY", "Only an active teacher or employee identity may have an active cooperative membership.");
    }
    await tx.cooperativeMember.update({ where: { id: member.id }, data: input });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: input.active ? "activate" : "deactivate", entityType: "CooperativeMember", entityId: member.id, after: { memberNo: member.memberNo, identityId: member.identityId, active: input.active } as unknown as Prisma.InputJsonValue } });
  });
  response.status(204).end();
}));
const storeReadRoles: UserRole[] = ["OWNER", "ADMIN", "CASHIER", "FINANCE_OFFICER", "ANALYST", "SUPER_ADMIN", "CHAIRMAN", "TREASURER", "BUSINESS_DEVELOPMENT", "ADMIN_STAFF", "AUDITOR"];
const storeManageRoles: UserRole[] = ["OWNER", "ADMIN", "SUPER_ADMIN", "BUSINESS_DEVELOPMENT", "ADMIN_STAFF"];
const storeHppRoles: UserRole[] = ["OWNER", "ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER", "TREASURER", "AUDITOR"];
const canManageStoreHpp = (role: UserRole) => storeManageRoles.includes(role) && storeHppRoles.includes(role);
const storeCategoryInput = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().optional(), active: z.boolean().optional() }).strict();
const storeCategoryQuery = z.object({ q: z.string().trim().max(120).optional(), active: z.enum(["true", "false"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const storePage = (page: number, pageSize: number, total: number) => ({ page, pageSize, total, pageCount: Math.ceil(total / pageSize) });
api.get("/product-categories", requireRoles(...storeReadRoles), asyncRoute(async (request, response) => {
  const query = storeCategoryQuery.parse(request.query); const where = { tenantId: me(request).tenantId, ...(query.active ? { active: query.active === "true" } : {}), ...(query.q ? { name: { contains: query.q, mode: "insensitive" as const } } : {}) };
  const [total, data] = await prisma.$transaction([prisma.productCategory.count({ where }), prisma.productCategory.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })]); response.json({ data, pagination: storePage(query.page, query.pageSize, total) });
}));
api.post("/product-categories", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const input = storeCategoryInput.parse(request.body); const actor = me(request); const category = await serializableStore(async (tx) => { const created = await tx.productCategory.create({ data: { tenantId: actor.tenantId, ...input } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "ProductCategory", entityId: created.id, after: { name: created.name, active: created.active } } }); return created; }); response.status(201).json(category);
}));
api.patch("/product-categories/:id", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const categoryId = id.parse(request.params.id); const input = storeCategoryInput.partial().refine((value) => Object.keys(value).length > 0).parse(request.body); const actor = me(request); const category = await serializableStore(async (tx) => { const current = await tx.productCategory.findFirst({ where: { id: categoryId, tenantId: actor.tenantId } }); if (!current) throw new HttpError(404, "NOT_FOUND", "Product category not found."); const updated = await tx.productCategory.update({ where: { id: current.id }, data: input }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "update", entityType: "ProductCategory", entityId: updated.id, after: { name: updated.name, active: updated.active } } }); return updated; }); response.json(category);
}));

const storeProductQuery = z.object({ q: z.string().trim().max(120).optional(), categoryId: id.optional(), active: z.enum(["true", "false"]).optional(), lowStock: z.enum(["true"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const storeProductInclude = { category: { select: { id: true, name: true, active: true } } } satisfies Prisma.ProductInclude;
type StoreProductPayload = Prisma.ProductGetPayload<{ include: typeof storeProductInclude }>;
function storeProductResponse(product: StoreProductPayload, includeHpp: boolean) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    category: product.category,
    unitPrice: asNumber(product.unitPrice),
    stockOnHand: product.stockOnHand,
    stock: product.stockOnHand,
    reorderLevel: product.reorderLevel,
    active: product.active,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    lowStock: product.stockOnHand <= product.reorderLevel,
    ...(includeHpp ? { unitCost: product.unitCost === null ? null : asNumber(product.unitCost) } : {}),
  };
}
api.get("/products", requireRoles(...storeReadRoles), asyncRoute(async (request, response) => {
  const query = storeProductQuery.parse(request.query);
  const actor = me(request);
  const where = { tenantId: actor.tenantId, ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.active ? { active: query.active === "true" } : {}), ...(query.q ? { OR: [{ sku: { contains: query.q, mode: "insensitive" as const } }, { name: { contains: query.q, mode: "insensitive" as const } }] } : {}) };
  const rows = await prisma.product.findMany({ where, include: storeProductInclude, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const filtered = query.lowStock ? rows.filter((product) => product.stockOnHand <= product.reorderLevel) : rows;
  const data = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((product) => storeProductResponse(product, storeHppRoles.includes(actor.role)));
  response.json({ data, pagination: storePage(query.page, query.pageSize, filtered.length) });
}));

const storeProductInput = z.object({ sku: storeSkuInput, name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).nullable().optional(), categoryId: id.nullable().optional(), unitPrice: money.positive(), unitCost: money.nullable().optional(), reorderLevel: z.coerce.number().int().min(0).max(1000000).default(0), initialStock: z.coerce.number().int().min(0).max(1000000).default(0), active: z.boolean().optional() }).strict();
const storeProductPatch = storeProductInput.omit({ initialStock: true }).partial().refine((value) => Object.keys(value).length > 0);
async function storeCategoryId(tx: Prisma.TransactionClient, tenantId: string, categoryId: string | null | undefined): Promise<string | null | undefined> { if (categoryId === undefined || categoryId === null) return categoryId; const category = await tx.productCategory.findFirst({ where: { id: categoryId, tenantId, active: true }, select: { id: true } }); if (!category) throw new HttpError(400, "INVALID_CATEGORY", "Category must be active and belong to this workspace."); return category.id; }
api.post("/products", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const input = storeProductInput.parse(request.body);
  const actor = me(request);
  if (input.unitCost !== undefined && !canManageStoreHpp(actor.role)) throw new HttpError(403, "HPP_FORBIDDEN", "Your role cannot set product HPP.");
  const product = await serializableStore(async (tx) => {
    const categoryId = await storeCategoryId(tx, actor.tenantId, input.categoryId);
    const created = await tx.product.create({ data: { tenantId: actor.tenantId, sku: input.sku, name: input.name, description: input.description ?? null, categoryId: categoryId ?? null, unitPrice: new Prisma.Decimal(input.unitPrice), unitCost: input.unitCost === undefined || input.unitCost === null ? null : new Prisma.Decimal(input.unitCost), reorderLevel: input.reorderLevel, stockOnHand: input.initialStock, active: input.active ?? true }, include: storeProductInclude });
    if (input.initialStock) await tx.stockMovement.create({ data: { tenantId: actor.tenantId, productId: created.id, quantity: input.initialStock, reason: "INITIAL_STOCK", reference: makeReference("STK"), balanceAfter: input.initialStock, performedById: actor.id } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "Product", entityId: created.id, after: { sku: created.sku, initialStock: input.initialStock } } });
    return created;
  });
  response.status(201).json(storeProductResponse(product, storeHppRoles.includes(actor.role)));
}));
api.patch("/products/:id", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const productId = id.parse(request.params.id);
  const input = storeProductPatch.parse(request.body);
  const actor = me(request);
  if (input.unitCost !== undefined && !canManageStoreHpp(actor.role)) throw new HttpError(403, "HPP_FORBIDDEN", "Your role cannot change product HPP.");
  const product = await serializableStore(async (tx) => {
    const current = await tx.product.findFirst({ where: { id: productId, tenantId: actor.tenantId } });
    if (!current) throw new HttpError(404, "NOT_FOUND", "Product not found.");
    const categoryId = await storeCategoryId(tx, actor.tenantId, input.categoryId);
    const updated = await tx.product.update({ where: { id: current.id }, data: { ...(input.sku === undefined ? {} : { sku: input.sku }), ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description }), ...(categoryId === undefined ? {} : { categoryId }), ...(input.unitPrice === undefined ? {} : { unitPrice: new Prisma.Decimal(input.unitPrice) }), ...(input.unitCost === undefined ? {} : { unitCost: input.unitCost === null ? null : new Prisma.Decimal(input.unitCost) }), ...(input.reorderLevel === undefined ? {} : { reorderLevel: input.reorderLevel }), ...(input.active === undefined ? {} : { active: input.active }) }, include: storeProductInclude });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "update", entityType: "Product", entityId: updated.id, after: { sku: updated.sku, active: updated.active } } });
    return updated;
  });
  response.json(storeProductResponse(product, storeHppRoles.includes(actor.role)));
}));
function publicStockMovement<T extends StockMovement>(movement: T) {
  const {
    idempotencyKey: _idempotencyKey,
    inputFingerprint: _inputFingerprint,
    ...visibleMovement
  } = movement;

  return visibleMovement;
}

async function idempotentInventoryMutation(
  tenantId: string,
  idempotencyKey: string,
  fingerprint: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<StockMovement>,
): Promise<{ movement: StockMovement; replayed: boolean }> {
  const verifyReplay = (existing: StockMovement) => {
    if (existing.inputFingerprint !== fingerprint) {
      throw new HttpError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key belongs to a different inventory operation.",
      );
    }

    return { movement: existing, replayed: true };
  };

  try {
    return await serializableStore(async (tx) => {
      const existing = await tx.stockMovement.findFirst({
        where: { tenantId, idempotencyKey },
      });

      if (existing) return verifyReplay(existing);

      const movement = await mutate(tx);
      return { movement, replayed: false };
    });
  } catch (error) {
    // A concurrent request can commit the same key first.
    // The failed transaction rolls back; inspect the committed row.
    const duplicateKey =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002";

    const exhaustedConflict =
      error instanceof HttpError &&
      error.code === "STORE_CONCURRENT_CONFLICT";

    if (!duplicateKey && !exhaustedConflict) throw error;

    const existing = await prisma.stockMovement.findFirst({
      where: { tenantId, idempotencyKey },
    });

    if (!existing) throw error;
    return verifyReplay(existing);
  }
}

api.post("/products/:id/receipts", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const productId = id.parse(request.params.id);
  const input = z.object({ quantity: z.coerce.number().int().positive().max(1000000), reference: z.string().trim().min(3).max(80).optional(), unitCost: money.nullable().optional() }).strict().parse(request.body);
  const idempotencyKey = inventoryIdempotencyKeySchema.parse(request.header("Idempotency-Key"));
  const actor = me(request);

  if (input.unitCost !== undefined && !canManageStoreHpp(actor.role)) {
    throw new HttpError(403, "HPP_FORBIDDEN", "Your role cannot change product HPP.");
  }

  const fingerprint = fingerprintInventoryMutation({
    operation: "STOCK_RECEIPT",
    productId,
    quantity: input.quantity,
    reference: input.reference,
    unitCost: input.unitCost,
  });

  const result = await idempotentInventoryMutation(
    actor.tenantId,
    idempotencyKey,
    fingerprint,
    async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId: actor.tenantId },
      });

      if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found.");

      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          stockOnHand: { increment: input.quantity },
          ...(input.unitCost === undefined
            ? {}
            : { unitCost: input.unitCost === null ? null : new Prisma.Decimal(input.unitCost) }),
        },
        select: { stockOnHand: true },
      });

      const created = await tx.stockMovement.create({
        data: {
          tenantId: actor.tenantId,
          productId: product.id,
          quantity: input.quantity,
          reason: "STOCK_RECEIPT",
          reference: input.reference ?? makeReference("RCV"),
          balanceAfter: updated.stockOnHand,
          performedById: actor.id,
          idempotencyKey,
          inputFingerprint: fingerprint,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.id,
          action: "receive_stock",
          entityType: "Product",
          entityId: product.id,
          after: {
            movementId: created.id,
            quantity: input.quantity,
            balanceAfter: updated.stockOnHand,
          },
        },
      });

      return created;
    },
  );

  response.status(result.replayed ? 200 : 201).json(
    publicStockMovement(result.movement),
  );
}));
api.post("/products/:id/adjustments", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const productId = id.parse(request.params.id);
  const input = z.object({ quantity: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, "Quantity cannot be zero."), reason: z.string().trim().min(3).max(160), reference: z.string().trim().min(3).max(80).optional() }).strict().parse(request.body);
  const idempotencyKey = inventoryIdempotencyKeySchema.parse(request.header("Idempotency-Key"));
  const actor = me(request);

  const fingerprint = fingerprintInventoryMutation({
    operation: "STOCK_ADJUSTMENT",
    productId,
    quantity: input.quantity,
    reason: input.reason,
    reference: input.reference,
  });

  const result = await idempotentInventoryMutation(
    actor.tenantId,
    idempotencyKey,
    fingerprint,
    async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId: actor.tenantId },
        select: { id: true },
      });

      if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found.");

      let stockOnHand: number;

      if (input.quantity < 0) {
        const updated = await tx.product.updateMany({
          where: {
            id: product.id,
            tenantId: actor.tenantId,
            stockOnHand: { gte: Math.abs(input.quantity) },
          },
          data: {
            stockOnHand: { decrement: Math.abs(input.quantity) },
          },
        });

        if (updated.count !== 1) {
          throw new HttpError(
            409,
            "INSUFFICIENT_STOCK",
            "Stock adjustment cannot make inventory negative.",
          );
        }

        stockOnHand = (await tx.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { stockOnHand: true },
        })).stockOnHand;
      } else {
        stockOnHand = (await tx.product.update({
          where: { id: product.id },
          data: { stockOnHand: { increment: input.quantity } },
          select: { stockOnHand: true },
        })).stockOnHand;
      }

      const created = await tx.stockMovement.create({
        data: {
          tenantId: actor.tenantId,
          productId: product.id,
          quantity: input.quantity,
          reason: "STOCK_ADJUSTMENT: " + input.reason,
          reference: input.reference ?? makeReference("ADJ"),
          balanceAfter: stockOnHand,
          performedById: actor.id,
          idempotencyKey,
          inputFingerprint: fingerprint,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.id,
          action: "adjust_stock",
          entityType: "Product",
          entityId: product.id,
          after: {
            movementId: created.id,
            quantity: input.quantity,
            reason: input.reason,
            balanceAfter: stockOnHand,
          },
        },
      });

      return created;
    },
  );

  response.status(result.replayed ? 200 : 201).json(
    publicStockMovement(result.movement),
  );
}));

api.get("/products/:id/movements", requireRoles(...storeReadRoles), asyncRoute(async(request,response)=>{const productId=id.parse(request.params.id);const query=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);const actor=me(request);if(!await prisma.product.findFirst({where:{id:productId,tenantId:actor.tenantId},select:{id:true}}))throw new HttpError(404,"NOT_FOUND","Product not found.");const where={tenantId:actor.tenantId,productId};const [total,data]=await prisma.$transaction([prisma.stockMovement.count({where}),prisma.stockMovement.findMany({where,include:{performedBy:{select:{name:true}}},orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(query.page-1)*query.pageSize,take:query.pageSize})]);response.json({data:data.map(publicStockMovement),pagination:storePage(query.page,query.pageSize,total)});}));

const storeSaleQuery = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(["COMPLETED", "VOIDED"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict();
api.get("/sales", requireRoles(...storeReadRoles), asyncRoute(async (request, response) => { const query=storeSaleQuery.parse(request.query); const where={tenantId:me(request).tenantId,...(query.status?{status:query.status}:{}),...(query.q?{receiptNo:{contains:query.q,mode:"insensitive" as const}}:{})}; const [total,data]=await prisma.$transaction([prisma.sale.count({where}),prisma.sale.findMany({where,include:storeSaleInclude,orderBy:[{occurredAt:"desc"},{id:"desc"}],skip:(query.page-1)*query.pageSize,take:query.pageSize})]); response.json({data:data.map((sale)=>storeSaleResponse(sale,storeHppRoles.includes(me(request).role))),pagination:storePage(query.page,query.pageSize,total)}); }));

const storeCheckoutInput = z.object({ paymentMethod: z.enum(["CASH", "TRANSFER", "QRIS"]), cashReceived: money.optional(), paymentReference: z.string().trim().min(3).max(100).optional(), customerIdentityId: id.optional(), items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive().max(999) }).strict()).min(1).max(50) }).strict().superRefine((input, context) => {
  if (input.paymentMethod === "CASH" && input.cashReceived === undefined) context.addIssue({ code: "custom", path: ["cashReceived"], message: "Cash received is required." });
  if (input.paymentMethod !== "CASH" && !input.paymentReference) context.addIssue({ code: "custom", path: ["paymentReference"], message: "A transfer or QRIS reference is required." });
});
const storeSaleInclude = { items: { include: { product: { select: { sku: true, name: true } } } }, payment: true, cashier: { select: { name: true } } } satisfies Prisma.SaleInclude;
type StoreSalePayload = Prisma.SaleGetPayload<{ include: typeof storeSaleInclude }>;
function storeSaleResponse(sale: StoreSalePayload, includeHpp: boolean) { const base={id:sale.id,receiptNo:sale.receiptNo,status:sale.status,paymentMethod:sale.paymentMethod,total:asNumber(sale.total),occurredAt:sale.occurredAt,voidReason:sale.voidReason,voidedAt:sale.voidedAt,cashier:sale.cashier,payment:sale.payment===null?null:{method:sale.payment.method,status:sale.payment.status,amount:asNumber(sale.payment.amount),cashReceived:sale.payment.cashReceived===null?null:asNumber(sale.payment.cashReceived),changeGiven:sale.payment.changeGiven===null?null:asNumber(sale.payment.changeGiven),reference:sale.payment.reference,recordedAt:sale.payment.recordedAt}};const items=sale.items.map((item)=>({id:item.id,productId:item.productId,sku:item.productSku,name:item.productName,quantity:item.quantity,unitPrice:asNumber(item.unitPrice),subtotal:asNumber(item.subtotal),...(includeHpp?{unitCost:item.unitCost===null?null:asNumber(item.unitCost),costSubtotal:item.costSubtotal===null?null:asNumber(item.costSubtotal),grossMargin:item.grossMargin===null?null:asNumber(item.grossMargin)}:{})}));return {...base,items,...(includeHpp?{totalCost:sale.totalCost===null?null:asNumber(sale.totalCost),grossMargin:sale.grossMargin===null?null:asNumber(sale.grossMargin)}:{})}; }

async function serializableStore<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withStoreTransactionRetry(() =>
    prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    }),
  );
}

async function serializableShuttle<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withSerializableTransactionRetry(
    () => prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    }),
    {
      code: "SHUTTLE_CONCURRENT_CONFLICT",
      message: "Shuttle records changed concurrently. Refresh and try again.",
    },
  );
}
api.post("/sales", requireRoles("OWNER", "ADMIN", "CASHIER", "SUPER_ADMIN"), asyncRoute(async (request, response) => {
  const input = storeCheckoutInput.parse(request.body);
  const idempotencyKey = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/).parse(request.header("Idempotency-Key"));
  const quantities = new Map<string, number>();
  for (const line of input.items) { const next = (quantities.get(line.productId) ?? 0) + line.quantity; if (next > 999) throw new HttpError(400, "INVALID_QUANTITY", "A product quantity cannot exceed 999."); quantities.set(line.productId, next); }
  const canonical = { paymentMethod: input.paymentMethod, cashReceived: input.cashReceived ?? null, paymentReference: input.paymentReference ?? null, customerIdentityId: input.customerIdentityId ?? null, items: [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)) };
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  const actor = me(request);
  let result: { sale: Prisma.SaleGetPayload<{ include: typeof storeSaleInclude }>; replayed: boolean };
  try {
    result = await serializableStore(async (tx) => {
      const existing = await tx.sale.findFirst({ where: { tenantId: actor.tenantId, idempotencyKey }, include: storeSaleInclude });
      if (existing) { if (existing.inputFingerprint !== fingerprint) throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to a different checkout."); return { sale: existing, replayed: true }; }
      if (input.customerIdentityId) { const customer = await tx.masterDataRecord.findFirst({ where: { id: input.customerIdentityId, tenantId: actor.tenantId, active: true, type: "STUDENT" }, select: { id: true } }); if (!customer) throw new HttpError(400, "INVALID_CUSTOMER", "Customer must be an active student from this workspace."); }
      const productIds = [...quantities.keys()].sort();
      const products = await tx.product.findMany({ where: { tenantId: actor.tenantId, id: { in: productIds }, active: true }, orderBy: { id: "asc" } });
      if (products.length !== productIds.length) throw new HttpError(400, "INVALID_PRODUCT", "One or more products are unavailable.");
      const byId = new Map(products.map((product) => [product.id, product]));
      const items = productIds.map((productId) => { const product = byId.get(productId); const quantity = quantities.get(productId); if (!product || quantity === undefined) throw new HttpError(400, "INVALID_PRODUCT", "Product is unavailable."); const unitPrice = new Prisma.Decimal(product.unitPrice); const subtotal = unitPrice.mul(quantity).toDecimalPlaces(2); const unitCost = product.unitCost === null ? null : new Prisma.Decimal(product.unitCost); const costSubtotal = unitCost === null ? null : unitCost.mul(quantity).toDecimalPlaces(2); return { productId: product.id, productSku: product.sku, productName: product.name, quantity, unitPrice, subtotal, unitCost, costSubtotal, grossMargin: costSubtotal === null ? null : subtotal.sub(costSubtotal).toDecimalPlaces(2) }; });
      const total = items.reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const totalCost = items.some((item) => item.costSubtotal === null) ? null : items.reduce((sum, item) => sum.add(item.costSubtotal ?? new Prisma.Decimal(0)), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const cashReceived = input.paymentMethod === "CASH" ? new Prisma.Decimal(input.cashReceived ?? 0).toDecimalPlaces(2) : null;
      if (cashReceived !== null && cashReceived.lessThan(total)) throw new HttpError(400, "INSUFFICIENT_CASH", "Cash received is below the server total.");
      const created = await tx.sale.create({ data: { tenantId: actor.tenantId, cashierId: actor.id, customerIdentityId: input.customerIdentityId, idempotencyKey, inputFingerprint: fingerprint, receiptNo: makeReference("POS"), paymentMethod: input.paymentMethod, total, totalCost, grossMargin: totalCost === null ? null : total.sub(totalCost).toDecimalPlaces(2), items: { create: items.map((item) => ({ product: { connect: { id: item.productId } }, productSku: item.productSku, productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, subtotal: item.subtotal, unitCost: item.unitCost, costSubtotal: item.costSubtotal, grossMargin: item.grossMargin })) } }, include: storeSaleInclude });
      for (const item of items) { const changed = await tx.product.updateMany({ where: { id: item.productId, tenantId: actor.tenantId, active: true, stockOnHand: { gte: item.quantity } }, data: { stockOnHand: { decrement: item.quantity } } }); if (changed.count !== 1) throw new HttpError(409, "INSUFFICIENT_STOCK", item.productName + " no longer has sufficient stock."); const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId }, select: { stockOnHand: true } }); await tx.stockMovement.create({ data: { tenantId: actor.tenantId, productId: item.productId, saleId: created.id, quantity: -item.quantity, reason: "POS_SALE", reference: created.receiptNo, balanceAfter: product.stockOnHand, performedById: actor.id } }); }
      await tx.storePayment.create({ data: { tenantId: actor.tenantId, saleId: created.id, recordedById: actor.id, method: input.paymentMethod, amount: total, cashReceived, changeGiven: cashReceived === null ? null : cashReceived.sub(total).toDecimalPlaces(2), reference: input.paymentMethod === "CASH" ? null : input.paymentReference } });
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "checkout", entityType: "Sale", entityId: created.id, after: { receiptNo: created.receiptNo, total: total.toString(), paymentMethod: input.paymentMethod, itemCount: items.length } } });
      return { sale: await tx.sale.findUniqueOrThrow({ where: { id: created.id }, include: storeSaleInclude }), replayed: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const existing = await prisma.sale.findFirst({ where: { tenantId: actor.tenantId, idempotencyKey }, include: storeSaleInclude }); if (existing?.inputFingerprint === fingerprint) result = { sale: existing, replayed: true }; else if (existing) throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to a different checkout."); else throw error; } else throw error;
  }
  response.status(result.replayed ? 200 : 201).json({ ...storeSaleResponse(result.sale, storeHppRoles.includes(actor.role)), idempotentReplay: result.replayed });
}));

const storeVoidRoles: UserRole[] = ["OWNER", "ADMIN", "SUPER_ADMIN", "BUSINESS_DEVELOPMENT"];
async function storeSaleForTenant(saleId: string, tenantId: string) { return prisma.sale.findFirst({ where: { id: saleId, tenantId }, include: storeSaleInclude }); }
api.get("/sales/:id", requireRoles(...storeReadRoles), asyncRoute(async (request,response)=>{const sale=await storeSaleForTenant(id.parse(request.params.id),me(request).tenantId);if(!sale)throw new HttpError(404,"NOT_FOUND","Sale not found.");response.json(storeSaleResponse(sale,storeHppRoles.includes(me(request).role)));}));
api.get("/sales/:id/receipt", requireRoles(...storeReadRoles), asyncRoute(async (request,response)=>{const sale=await storeSaleForTenant(id.parse(request.params.id),me(request).tenantId);if(!sale)throw new HttpError(404,"NOT_FOUND","Sale not found.");response.json({printable:true,receipt:storeSaleResponse(sale,false)});}));
api.post("/sales/:id/void", requireRoles(...storeVoidRoles), asyncRoute(async (request,response)=>{const saleId=id.parse(request.params.id);const input=z.object({reason:z.string().trim().min(5).max(500)}).strict().parse(request.body);const actor=me(request);const sale=await serializableStore(async(tx)=>{const current=await tx.sale.findFirst({where:{id:saleId,tenantId:actor.tenantId},include:{items:true}});if(!current)throw new HttpError(404,"NOT_FOUND","Sale not found.");const claimed=await tx.sale.updateMany({where:{id:current.id,tenantId:actor.tenantId,status:"COMPLETED"},data:{status:"VOIDED",voidReason:input.reason,voidedAt:new Date(),voidedById:actor.id}});if(claimed.count!==1)throw new HttpError(409,"SALE_ALREADY_VOIDED","This sale was already voided.");for(const item of current.items){const product=await tx.product.update({where:{id:item.productId},data:{stockOnHand:{increment:item.quantity}},select:{stockOnHand:true}});await tx.stockMovement.create({data:{tenantId:actor.tenantId,productId:item.productId,saleId:current.id,quantity:item.quantity,reason:"POS_VOID",reference:current.receiptNo,balanceAfter:product.stockOnHand,performedById:actor.id}});}await tx.auditLog.create({data:{tenantId:actor.tenantId,actorId:actor.id,action:"void",entityType:"Sale",entityId:current.id,after:{receiptNo:current.receiptNo,reason:input.reason}}});return tx.sale.findUniqueOrThrow({where:{id:current.id},include:storeSaleInclude});});response.json(storeSaleResponse(sale,storeHppRoles.includes(actor.role)));}));

const shuttleRouteCreateInput = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(120),
  stops: z.array(z.string().trim().min(2)).min(2).max(30),
  monthlyRate: z.coerce.number().finite().int().min(1).max(999_999_999),
}).strict();
const shuttleRouteListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const shuttleSubscriptionCreateInput = z.object({
  memberId: id.optional(),
  studentIdentityId: id.optional(),
  routeId: id,
  startDate: date,
  endDate: date.optional(),
  payerName: z.string().trim().min(2).max(120).optional(),
  payerContact: z.string().trim().min(5).max(120).optional(),
}).strict().superRefine((input, context) => {
  if (input.endDate && input.endDate.getTime() < input.startDate.getTime()) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "End date cannot be before start date." });
  }
  if ((input.memberId ? 1 : 0) + (input.studentIdentityId ? 1 : 0) !== 1) {
    context.addIssue({ code: "custom", message: "Provide exactly one student identity or eligible cooperative member." });
  }
});
const shuttleSubscriptionListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  routeId: id.optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const shuttleOpsRoles: UserRole[] = ["OWNER", "ADMIN", "SUPER_ADMIN", "ADMIN_STAFF", "FLEET_MANAGER"];
// D05-05 remains provisional, but the server keeps the current least-privilege
// boundary explicit: cashiers can only record/choose collectible invoices;
// finance officers verify and read Shuttle finance; treasurers approve payouts.
const shuttleFinanceRoles: UserRole[] = ["OWNER", "ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER", "TREASURER"];
const shuttleSubscriptionResponseSelect = {
  id: true,
  routeId: true,
  memberId: true,
  studentIdentityId: true,
  status: true,
  startDate: true,
  endDate: true,
  effectiveMonthlyRate: true,
  route: { select: { id: true, code: true, name: true, active: true, monthlyRate: true } },
  member: { select: { id: true, memberNo: true, name: true } },
  studentIdentity: { select: { id: true, identifier: true, fullName: true } },
} satisfies Prisma.ShuttleSubscriptionSelect;
type ShuttleSubscriptionResponseRecord = Prisma.ShuttleSubscriptionGetPayload<{ select: typeof shuttleSubscriptionResponseSelect }>;

/** Deliberately exclude tenant IDs, contact details, full student records, and invoices. */
function shuttleRupiahResponseValue(value: { toString(): string }, field: "effectiveMonthlyRate" | "route.monthlyRate"): number;
function shuttleRupiahResponseValue(value: { toString(): string } | null, field: "effectiveMonthlyRate" | "route.monthlyRate"): number | null;
function shuttleRupiahResponseValue(value: { toString(): string } | null, field: "effectiveMonthlyRate" | "route.monthlyRate"): number | null {
  if (value === null) return null;
  const amount = shuttleRupiahBigInt(value, "INVALID_SHUTTLE_RATE");
  if (amount < 1n) throw new HttpError(500, "INVALID_SHUTTLE_RATE", `Stored ${field} is outside the approved whole-Rupiah contract.`);
  return shuttleRupiahNumber(amount, "INVALID_SHUTTLE_RATE");
}

function shuttleSubscriptionResponse(subscription: ShuttleSubscriptionResponseRecord) {
  return {
    id: subscription.id,
    routeId: subscription.routeId,
    memberId: subscription.memberId,
    studentIdentityId: subscription.studentIdentityId,
    status: subscription.status,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    effectiveMonthlyRate: shuttleRupiahResponseValue(subscription.effectiveMonthlyRate, "effectiveMonthlyRate"),
    route: {
      ...subscription.route,
      monthlyRate: shuttleRupiahResponseValue(subscription.route.monthlyRate, "route.monthlyRate"),
    },
    member: subscription.member,
    studentIdentity: subscription.studentIdentity,
  };
}

api.get("/shuttle/routes", asyncRoute(async (request, response) => {
  const query = shuttleRouteListQuery.parse(request.query);
  const where = {
    tenantId: me(request).tenantId,
    ...(query.active ? { active: query.active === "true" } : {}),
    ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" as const } }, { name: { contains: query.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, routes] = await prisma.$transaction([
    prisma.shuttleRoute.count({ where }),
    prisma.shuttleRoute.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  response.json({ data: decimalJson(routes), pagination: storePage(query.page, query.pageSize, total) });
}));

api.post("/shuttle/routes", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER"), asyncRoute(async (request, response) => {
  const input = shuttleRouteCreateInput.parse(request.body);
  const actor = me(request);
  const route = await serializableShuttle(async (tx) => {
    const created = await tx.shuttleRoute.create({ data: { ...input, tenantId: actor.tenantId } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "ShuttleRoute", entityId: created.id, after: auditSnapshot(created) } });
    return created;
  });
  response.status(201).json(decimalJson(route));
}));

api.get("/shuttle/subscriptions", asyncRoute(async (request, response) => {
  const query = shuttleSubscriptionListQuery.parse(request.query);
  const where = {
    tenantId: me(request).tenantId,
    ...(query.routeId ? { routeId: query.routeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? {
      OR: [
        { member: { name: { contains: query.q, mode: "insensitive" as const } } },
        { member: { memberNo: { contains: query.q, mode: "insensitive" as const } } },
        { route: { code: { contains: query.q, mode: "insensitive" as const } } },
        { route: { name: { contains: query.q, mode: "insensitive" as const } } },
      ],
    } : {}),
  };
  const [total, subscriptions] = await prisma.$transaction([
    prisma.shuttleSubscription.count({ where }),
    prisma.shuttleSubscription.findMany({ where, select: shuttleSubscriptionResponseSelect, orderBy: [{ startDate: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  response.json({ data: subscriptions.map(shuttleSubscriptionResponse), pagination: storePage(query.page, query.pageSize, total) });
}));

api.post("/shuttle/subscriptions", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER"), asyncRoute(async (request, response) => {
  const input = shuttleSubscriptionCreateInput.parse(request.body);
  const actor = me(request);
  const subscription = await serializableShuttle(async (tx) => {
    const [member, student, route] = await Promise.all([
      input.memberId ? tx.cooperativeMember.findFirst({ where: { id: input.memberId, tenantId: actor.tenantId }, include: { identity: { select: { id: true, type: true, active: true } } } }) : null,
      input.studentIdentityId ? tx.masterDataRecord.findFirst({ where: { id: input.studentIdentityId, tenantId: actor.tenantId, type: "STUDENT", active: true } }) : null,
      tx.shuttleRoute.findFirst({ where: { id: input.routeId, tenantId: actor.tenantId, active: true } }),
    ]);
    if (input.memberId && !member) throw new HttpError(404, "NOT_FOUND", "Member not found.");
    if (member && (!member.active || !member.identity || !member.identity.active || member.identity.type === "STUDENT")) {
      throw new HttpError(400, "INELIGIBLE_COOPERATIVE_MEMBER", "An active teacher or employee identity is required for new cooperative-benefit operations.");
    }
    if (input.studentIdentityId && !student) throw new HttpError(400, "INVALID_SHUTTLE_STUDENT", "An active same-tenant student identity is required.");
    if (!route) throw new HttpError(400, "INVALID_SUBSCRIPTION", "Member or route is unavailable.");
    const existing = await tx.shuttleSubscription.findFirst({ where: { tenantId: actor.tenantId, status: "ACTIVE", routeId: route.id, ...(student ? { studentIdentityId: student.id } : { memberId: member!.id }) } });
    if (existing) throw new HttpError(409, "DUPLICATE_ACTIVE_SUBSCRIPTION", "This rider already has an active subscription for the route.");
    const created = await tx.shuttleSubscription.create({ data: { ...input, tenantId: actor.tenantId, effectiveMonthlyRate: route.monthlyRate } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "ShuttleSubscription", entityId: created.id, after: auditSnapshot(created) } });
    return tx.shuttleSubscription.findUniqueOrThrow({ where: { id: created.id }, select: shuttleSubscriptionResponseSelect });
  });
  response.status(201).json(shuttleSubscriptionResponse(subscription));
}));

const shuttleCancellationInput = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();

api.post("/shuttle/subscriptions/:id/cancel", requireRoles(...shuttleOpsRoles), asyncRoute(async (request, response) => {
  const subscriptionId = id.parse(request.params.id);
  const input = shuttleCancellationInput.parse(request.body);
  const actor = me(request);
  const result = await serializableShuttle(async (tx) => {
    const current = await tx.shuttleSubscription.findFirst({ where: { id: subscriptionId, tenantId: actor.tenantId } });
    if (!current) throw new HttpError(404, "NOT_FOUND", "Subscription not found.");
    if (current.status === "CANCELLED") {
      return { subscription: await tx.shuttleSubscription.findUniqueOrThrow({ where: { id: current.id }, select: shuttleSubscriptionResponseSelect }), changed: false };
    }

    const changed = await tx.shuttleSubscription.updateMany({
      where: { id: current.id, tenantId: actor.tenantId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED" },
    });
    if (changed.count !== 1) throw new HttpError(409, "SUBSCRIPTION_CANCELLATION_CONFLICT", "Subscription cancellation could not be completed.");

    const cancelled = await tx.shuttleSubscription.findUniqueOrThrow({ where: { id: current.id }, select: shuttleSubscriptionResponseSelect });
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: "cancel",
        entityType: "ShuttleSubscription",
        entityId: cancelled.id,
        before: auditSnapshot(current),
        after: { subscriptionId: cancelled.id, status: cancelled.status, reason: input.reason },
      },
    });
    return { subscription: cancelled, changed: true };
  });
  response.json(shuttleSubscriptionResponse(result.subscription));
}));

api.post("/shuttle/subscriptions/:id/invoices", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  id.parse(request.params.id);
  throw new HttpError(409, "LEGACY_SHUTTLE_INVOICE_ENDPOINT_RETIRED", "Create and finalize a Shuttle billing period before collecting a Shuttle invoice.");
}));

api.get("/billing/invoices", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId: me(request).tenantId },
    select: {
      id: true, invoiceNo: true, description: true, amount: true, status: true,
      dueDate: true, issuedAt: true, finalizedAt: true, routeCodeSnapshot: true,
      routeNameSnapshot: true, proratedDays: true, periodDays: true,
      payments: {
        select: {
          id: true, amount: true, method: true, reference: true, status: true,
          paidAt: true, verifiedAt: true, reversalReason: true,
        },
      },
      subscription: {
        select: {
          route: { select: { id: true, code: true, name: true, stops: true, active: true, monthlyRate: true } },
          member: { select: { id: true, memberNo: true, name: true } },
          studentIdentity: { select: { id: true, identifier: true, fullName: true } },
        },
      },
    },
    orderBy: { issuedAt: "desc" },
    take: 100,
  });
  response.json({ data: decimalJson(invoices) });
}));

api.get("/shuttle/billing/collectible-invoices", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER", "CASHIER"), asyncRoute(async (request, response) => {
  const query = shuttleCollectibleInvoiceQuery.parse(request.query);
  const actor = me(request);
  const searchClause = query.q
    ? Prisma.sql`AND (i."invoiceNo" ILIKE ${`%${sqlLikeLiteral(query.q)}%`} ESCAPE '!' OR COALESCE(i."routeNameSnapshot", '') ILIKE ${`%${sqlLikeLiteral(query.q)}%`} ESCAPE '!')`
    : Prisma.empty;
  const committedPayments = Prisma.sql`
    SELECT "invoiceId", SUM("amount") AS committed
    FROM "Payment"
    WHERE "tenantId" = ${actor.tenantId} AND "status" IN ('RECORDED', 'VERIFIED')
    GROUP BY "invoiceId"
  `;
  const eligibleWhere = Prisma.sql`
    FROM "Invoice" AS i
    LEFT JOIN committed_payments AS cp ON cp."invoiceId" = i."id"
    WHERE i."tenantId" = ${actor.tenantId}
      AND i."shuttleBillingPeriodId" IS NOT NULL
      AND i."status" = 'ISSUED'
      AND EXISTS (
        SELECT 1 FROM "ShuttleBillingPeriod" AS bp
        WHERE bp."id" = i."shuttleBillingPeriodId"
          AND bp."tenantId" = i."tenantId"
          AND bp."status" = 'FINALIZED'
      )
      AND i."amount" > COALESCE(cp.committed, 0)
      ${searchClause}
  `;
  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`WITH committed_payments AS (${committedPayments}) SELECT COUNT(*)::bigint AS total ${eligibleWhere}`),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH committed_payments AS (${committedPayments}) SELECT i."id" ${eligibleWhere} ORDER BY i."dueDate" ASC NULLS LAST, i."invoiceNo" ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
  ]);
  const ids = idRows.map((row) => row.id);
  const invoices = ids.length ? await prisma.invoice.findMany({
    where: { tenantId: actor.tenantId, shuttleBillingPeriodId: { not: null }, id: { in: ids } },
    select: {
      id: true, invoiceNo: true, amount: true, status: true, dueDate: true, routeNameSnapshot: true,
      shuttleBillingPeriod: { select: { startsAt: true, endsAt: true } },
      subscription: { select: { payerName: true, member: { select: { name: true } }, studentIdentity: { select: { fullName: true } }, route: { select: { name: true } } } },
      payments: { where: { status: { in: ["RECORDED", "VERIFIED"] } }, select: { amount: true } },
    },
  }) : [];
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const data = ids.flatMap((invoiceId) => {
    const invoice = invoicesById.get(invoiceId);
    if (!invoice) return [];
    const amount = shuttleRupiahBigInt(invoice.amount);
    const committed = sumShuttleRupiah(invoice.payments.map((payment) => payment.amount));
    const collectibleAmount = amount - committed;
    if (collectibleAmount <= 0n) return [];
    return [{
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      riderName: invoice.subscription?.payerName ?? invoice.subscription?.studentIdentity?.fullName ?? invoice.subscription?.member?.name ?? null,
      routeName: invoice.routeNameSnapshot ?? invoice.subscription?.route.name ?? null,
      billingPeriod: invoice.shuttleBillingPeriod ? { startsAt: invoice.shuttleBillingPeriod.startsAt, endsAt: invoice.shuttleBillingPeriod.endsAt } : null,
      amount: shuttleRupiahNumber(amount),
      collectibleAmount: shuttleRupiahNumber(collectibleAmount),
      status: invoice.status,
      dueDate: invoice.dueDate,
    }];
  });
  response.json({ data, pagination: storePage(query.page, query.pageSize, Number(countRows[0]?.total ?? 0n)) });
}));

api.post("/billing/invoices/:id/void", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const invoiceId = id.parse(request.params.id);
  const input = shuttleCancellationInput.parse(request.body);
  const actor = me(request);
  const result = await serializableShuttle(async (tx) => {
    const current = await tx.invoice.findFirst({
      where: { id: invoiceId, tenantId: actor.tenantId, shuttleBillingPeriodId: { not: null } },
      include: { payments: { include: { shuttleSettlements: true } }, shuttleBillingPeriod: { select: { settlements: { select: { id: true } } } } },
    });
    if (!current) throw new HttpError(404, "NOT_FOUND", "Shuttle invoice not found.");
    if (current.status === "VOID") return { invoice: current, changed: false };
    if (current.payments.some((payment) => payment.shuttleSettlements.length > 0)) {
      throw new HttpError(409, "INVOICE_SETTLED", "A settled invoice requires a settlement correction before it can be voided.");
    }
    if (current.payments.length > 0) {
      throw new HttpError(409, "INVOICE_HAS_PAYMENTS", "Invoices with payments cannot be voided.");
    }
    if (current.shuttleBillingPeriod?.settlements.length) {
      throw new HttpError(409, "BILLING_PERIOD_SETTLED", "A settled billing period requires a settlement correction before an invoice can change.");
    }
    if (current.status !== "ISSUED") throw new HttpError(409, "INVOICE_NOT_VOIDABLE", "Only an issued Shuttle invoice without payments can be voided.");
    const changed = await tx.invoice.updateMany({
      where: { id: current.id, tenantId: actor.tenantId, status: { not: "VOID" } },
      data: { status: "VOID" },
    });
    if (changed.count !== 1) throw new HttpError(409, "INVOICE_VOID_CONFLICT", "Invoice void could not be completed.");
    const voided = await tx.invoice.findUniqueOrThrow({ where: { id: current.id } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "void", entityType: "Invoice", entityId: voided.id, before: auditSnapshot(current), after: { invoiceId: voided.id, status: voided.status, reason: input.reason } } });
    return { invoice: voided, changed: true };
  });
  response.json(decimalJson(result.invoice));
}));

api.post("/billing/invoices/:id/payments", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER", "CASHIER"), asyncRoute(async (request, response) => {
  const invoiceId = id.parse(request.params.id);
  const input = z.object({ amount: shuttleMoneyInput, method: paymentMethod, reference: z.string().trim().min(3).max(80) }).strict().parse(request.body);
  const actor = me(request);
  try {
    const result = await serializableShuttle(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId: actor.tenantId, shuttleBillingPeriodId: { not: null } }, include: { payments: true, shuttleBillingPeriod: { select: { status: true, settlements: { select: { id: true } } } } } });
      if (!invoice) throw new HttpError(404, "NOT_FOUND", "Shuttle invoice not found.");
      const existing = await tx.payment.findFirst({ where: { tenantId: actor.tenantId, reference: input.reference } });
      if (existing) {
        const samePayload = existing.invoiceId === invoice.id && existing.method === input.method && shuttleRupiahBigInt(existing.amount) === BigInt(input.amount);
        if (!samePayload || existing.status === null || existing.status === "REVERSED") throw new HttpError(409, "PAYMENT_REFERENCE_REUSED", "This payment reference cannot be replayed for a Shuttle payment.");
        return { payment: existing, replayed: true };
      }
      if (invoice.shuttleBillingPeriod?.settlements.length) throw new HttpError(409, "BILLING_PERIOD_SETTLED", "A settled billing period cannot accept new payments.");
      if (invoice.status !== "ISSUED" || invoice.shuttleBillingPeriod?.status !== "FINALIZED") throw new HttpError(409, "INVOICE_NOT_COLLECTIBLE", "Only issued invoices in a finalized Shuttle billing period can receive payments.");
      const committed = sumShuttleRupiah(invoice.payments.filter((item) => item.status === "RECORDED" || item.status === "VERIFIED").map((item) => item.amount));
      const verifiedAmount = sumShuttleRupiah(invoice.payments.filter((item) => item.status === "VERIFIED").map((item) => item.amount));
      const invoiceAmount = shuttleRupiahBigInt(invoice.amount);
      const requested = BigInt(input.amount);
      if (committed + requested > invoiceAmount) throw new HttpError(409, "OVERPAYMENT", "Payment exceeds the remaining invoice amount.");
      const verified = actor.role !== "CASHIER";
      const created = await tx.payment.create({ data: { tenantId: actor.tenantId, invoiceId, ...input, status: verified ? "VERIFIED" : "RECORDED", verifiedAt: verified ? new Date() : null, verifiedById: verified ? actor.id : null } });
      if (verified && verifiedAmount + requested === invoiceAmount) await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "record_payment", entityType: "Payment", entityId: created.id, after: auditSnapshot(created) } });
      return { payment: created, replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json(decimalJson({ ...result.payment, idempotentReplay: result.replayed }));
  } catch (error) {
    if (!isPaymentReferenceUniqueConflict(error)) throw error;
    const [invoice, existing] = await Promise.all([
      prisma.invoice.findFirst({ where: { id: invoiceId, tenantId: actor.tenantId, shuttleBillingPeriodId: { not: null } } }),
      prisma.payment.findFirst({ where: { tenantId: actor.tenantId, reference: input.reference } }),
    ]);
    if (!invoice || !existing) throw error;
    if (existing.invoiceId !== invoice.id || shuttleRupiahBigInt(existing.amount) !== BigInt(input.amount) || existing.method !== input.method || existing.status === null || existing.status === "REVERSED") {
      throw new HttpError(409, "PAYMENT_REFERENCE_REUSED", "This payment reference belongs to a different payment.");
    }
    response.status(200).json(decimalJson({ ...existing, idempotentReplay: true }));
  }
}));

async function updateShuttleInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, shuttleBillingPeriodId: { not: null } }, include: { payments: true } });
  if (!invoice) throw new HttpError(404, "NOT_FOUND", "Shuttle invoice not found.");
  const verified = sumShuttleRupiah(invoice.payments.filter((payment) => payment.status === "VERIFIED").map((payment) => payment.amount));
  const invoiceAmount = shuttleRupiahBigInt(invoice.amount);
  await tx.invoice.update({ where: { id: invoice.id }, data: { status: verified >= invoiceAmount ? "PAID" : "ISSUED" } });
}
api.post("/billing/payments/:id/verify", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const paymentId = id.parse(request.params.id); const actor = me(request);
  const payment = await serializableShuttle(async (tx) => { const current = await tx.payment.findFirst({ where: { id: paymentId, tenantId: actor.tenantId }, include: { invoice: { include: { shuttleBillingPeriod: { select: { status: true, settlements: { select: { id: true } } } } } } } }); if (!current || current.status === null || current.invoice.shuttleBillingPeriodId === null) throw new HttpError(404, "NOT_FOUND", "Shuttle payment not found."); if (current.status === "REVERSED") throw new HttpError(409, "PAYMENT_REVERSED", "A reversed payment cannot be verified."); if (current.status === "VERIFIED") return current; if (current.invoice.shuttleBillingPeriod?.settlements.length) throw new HttpError(409, "BILLING_PERIOD_SETTLED", "A settled billing period cannot verify additional payments."); if (current.invoice.status !== "ISSUED" || current.invoice.shuttleBillingPeriod?.status !== "FINALIZED") throw new HttpError(409, "INVOICE_NOT_COLLECTIBLE", "The Shuttle invoice is not collectible."); const verified = await tx.payment.update({ where: { id: current.id }, data: { status: "VERIFIED", verifiedAt: new Date(), verifiedById: actor.id } }); await updateShuttleInvoiceStatus(tx, current.invoiceId); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "verify", entityType: "Payment", entityId: current.id, after: auditSnapshot(verified) } }); return verified; }); response.json(decimalJson(payment));
}));
api.post("/billing/payments/:id/reverse", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const paymentId = id.parse(request.params.id); const input = z.object({ reason: z.string().trim().min(5).max(500) }).strict().parse(request.body); const actor = me(request);
  const payment = await serializableShuttle(async (tx) => { const current = await tx.payment.findFirst({ where: { id: paymentId, tenantId: actor.tenantId }, include: { shuttleSettlements: true, invoice: { include: { shuttleBillingPeriod: { select: { settlements: { select: { id: true } } } } } } } }); if (!current || current.status === null || current.invoice.shuttleBillingPeriodId === null) throw new HttpError(404, "NOT_FOUND", "Shuttle payment not found."); if (current.status === "REVERSED") throw new HttpError(409, "PAYMENT_ALREADY_REVERSED", "Payment was already reversed."); if (current.shuttleSettlements.length || current.invoice.shuttleBillingPeriod?.settlements.length) throw new HttpError(409, "PAYMENT_ALLOCATED_TO_SETTLEMENT", "Reverse requires a settlement correction before a settled payment can change."); const reversed = await tx.payment.update({ where: { id: current.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.id, reversalReason: input.reason } }); await updateShuttleInvoiceStatus(tx, current.invoiceId); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "reverse", entityType: "Payment", entityId: current.id, after: auditSnapshot(reversed) } }); return reversed; }); response.json(decimalJson(payment));
}));

const shuttleMoneyInput = z.coerce.number().finite().int().min(1).max(999_999_999);
const shuttlePeriodInput = z.object({ year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12) }).strict();
const shuttleConfigInput = z.object({ vendorName: z.string().trim().min(2).max(160), vendorShareBps: z.coerce.number().int().min(0).max(10_000), cooperativeShareBps: z.coerce.number().int().min(0).max(10_000) }).strict().refine((input) => input.vendorShareBps + input.cooperativeShareBps === 10_000, "Vendor and cooperative shares must total 100%." );

api.get("/shuttle/financial-config", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  response.json({ data: await prisma.shuttleFinancialConfig.findUnique({ where: { tenantId: me(request).tenantId } }) });
}));
api.put("/shuttle/financial-config", requireRoles("OWNER", "ADMIN", "SUPER_ADMIN"), asyncRoute(async (request, response) => {
  const input = shuttleConfigInput.parse(request.body); const actor = me(request);
  const config = await serializableShuttle(async (tx) => { const saved = await tx.shuttleFinancialConfig.upsert({ where: { tenantId: actor.tenantId }, create: { ...input, tenantId: actor.tenantId }, update: input }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "configure", entityType: "ShuttleFinancialConfig", entityId: saved.id, after: auditSnapshot(saved) } }); return saved; });
  response.json(config);
}));
api.post("/shuttle/billing-periods", requireRoles(...shuttleOpsRoles), asyncRoute(async (request, response) => {
  const { year, month } = shuttlePeriodInput.parse(request.body); const actor = me(request); const bounds = jakartaMonth(year, month);
  const period = await serializableShuttle(async (tx) => { const existing = await tx.shuttleBillingPeriod.findUnique({ where: { tenantId_startsAt: { tenantId: actor.tenantId, startsAt: bounds.startsAt } } }); if (existing) return existing; const created = await tx.shuttleBillingPeriod.create({ data: { tenantId: actor.tenantId, startsAt: bounds.startsAt, endsAt: bounds.endsAt } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "ShuttleBillingPeriod", entityId: created.id, after: auditSnapshot(created) } }); return created; });
  response.status(201).json(period);
}));
api.get("/shuttle/billing-periods", requireRoles(...shuttleOpsRoles), asyncRoute(async (request, response) => {
  response.json({ data: await prisma.shuttleBillingPeriod.findMany({ where: { tenantId: me(request).tenantId }, orderBy: { startsAt: "desc" }, take: 100 }) });
}));
api.post("/shuttle/billing-periods/:id/generate", requireRoles(...shuttleOpsRoles), asyncRoute(async (request, response) => {
  const periodId = id.parse(request.params.id); const actor = me(request);
  const result = await serializableShuttle(async (tx) => {
    const period = await tx.shuttleBillingPeriod.findFirst({ where: { id: periodId, tenantId: actor.tenantId } });
    if (!period) throw new HttpError(404, "NOT_FOUND", "Billing period not found.");
    if (period.status !== "OPEN") throw new HttpError(409, "BILLING_PERIOD_FINALIZED", "Finalized billing periods cannot generate invoices.");
    const periodDays = jakartaPeriodDays(period.startsAt, period.endsAt);
    const subscriptions = await tx.shuttleSubscription.findMany({ where: { tenantId: actor.tenantId, status: "ACTIVE", startDate: { lt: period.endsAt }, OR: [{ endDate: null }, { endDate: { gte: period.startsAt } }] }, include: { route: true } });
    let created = 0;
    for (const subscription of subscriptions) {
      const existing = await tx.invoice.findFirst({ where: { tenantId: actor.tenantId, subscriptionId: subscription.id, shuttleBillingPeriodId: period.id } });
      if (existing) continue;
      const activeDays = inclusiveActiveDays(subscription, period.startsAt, period.endsAt);
      if (!activeDays) continue;
      const rate = shuttleRupiahNumber(shuttleRupiahBigInt(subscription.effectiveMonthlyRate ?? subscription.route.monthlyRate));
      const amount = proratedRupiah(rate, activeDays, periodDays);
      if (amount < 1) throw new HttpError(409, "PRORATED_AMOUNT_BELOW_ONE_RUPIAH", "Proration produced less than one Rupiah; correct the rate or billing dates before generation.");
      await tx.invoice.create({ data: { tenantId: actor.tenantId, subscriptionId: subscription.id, shuttleBillingPeriodId: period.id, invoiceNo: makeReference("SHI"), description: `Shuttle ${subscription.route.name} ${jakartaPeriodLabel(period.startsAt)}`, amount, status: "DRAFT", routeCodeSnapshot: subscription.route.code, routeNameSnapshot: subscription.route.name, rateSnapshot: rate, proratedDays: activeDays, periodDays } });
      created += 1;
    }
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "generate", entityType: "ShuttleBillingPeriod", entityId: period.id, after: { created } });
    return { created };
  });
  response.json(result);
}));
api.post("/shuttle/billing-periods/:id/finalize", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const periodId = id.parse(request.params.id); const actor = me(request);
  const period = await serializableShuttle(async (tx) => { const current = await tx.shuttleBillingPeriod.findFirst({ where: { id: periodId, tenantId: actor.tenantId } }); if (!current) throw new HttpError(404, "NOT_FOUND", "Billing period not found."); if (current.status === "FINALIZED") return current; const issuedAt = new Date(); await tx.invoice.updateMany({ where: { tenantId: actor.tenantId, shuttleBillingPeriodId: current.id, status: "DRAFT" }, data: { status: "ISSUED", issuedAt, finalizedAt: issuedAt, finalizedById: actor.id } }); const finalized = await tx.shuttleBillingPeriod.update({ where: { id: current.id }, data: { status: "FINALIZED", finalizedAt: issuedAt, finalizedById: actor.id } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "finalize", entityType: "ShuttleBillingPeriod", entityId: current.id, after: auditSnapshot(finalized) } }); return finalized; }); response.json(period);
}));
api.post("/shuttle/billing-periods/:id/settlements", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const periodId = id.parse(request.params.id); const actor = me(request);
  try {
    const settlement = await serializableShuttle(async (tx) => {
      const [period, config] = await Promise.all([tx.shuttleBillingPeriod.findFirst({ where: { id: periodId, tenantId: actor.tenantId } }), tx.shuttleFinancialConfig.findUnique({ where: { tenantId: actor.tenantId } })]);
      if (!period || period.status !== "FINALIZED") throw new HttpError(409, "BILLING_PERIOD_NOT_FINALIZED", "Finalize the billing period before settlement.");
      if (!config?.active) throw new HttpError(400, "SHUTTLE_CONFIG_REQUIRED", "An active 100% share configuration is required.");
      const existing = await tx.shuttleSettlement.findUnique({ where: { tenantId_billingPeriodId: { tenantId: actor.tenantId, billingPeriodId: period.id } } });
      if (existing) return { settlement: existing, replayed: true };
      const payments = await tx.payment.findMany({ where: { tenantId: actor.tenantId, status: "VERIFIED", invoice: { shuttleBillingPeriodId: period.id } } });
      const verifiedAmount = sumShuttleRupiah(payments.map((payment) => payment.amount), "INVALID_SETTLEMENT_AMOUNT");
      const vendorAmount = verifiedAmount * BigInt(config.vendorShareBps) / 10_000n;
      const cooperativeAmount = verifiedAmount - vendorAmount;
      const created = await tx.shuttleSettlement.create({ data: { tenantId: actor.tenantId, billingPeriodId: period.id, vendorNameSnapshot: config.vendorName, vendorShareBps: config.vendorShareBps, cooperativeShareBps: config.cooperativeShareBps, verifiedAmount: shuttleRupiahNumber(verifiedAmount, "INVALID_SETTLEMENT_AMOUNT"), vendorAmount: shuttleRupiahNumber(vendorAmount, "INVALID_SETTLEMENT_AMOUNT"), cooperativeAmount: shuttleRupiahNumber(cooperativeAmount, "INVALID_SETTLEMENT_AMOUNT"), payments: { create: payments.map((payment) => ({ paymentId: payment.id })) } } });
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "ShuttleSettlement", entityId: created.id, after: auditSnapshot(created) } });
      return { settlement: created, replayed: false };
    });
    response.status(settlement.replayed ? 200 : 201).json({ ...shuttleSettlementJson(settlement.settlement), idempotentReplay: settlement.replayed });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.shuttleSettlement.findUnique({ where: { tenantId_billingPeriodId: { tenantId: actor.tenantId, billingPeriodId: periodId } } });
    if (!existing) throw error;
    response.status(200).json({ ...shuttleSettlementJson(existing), idempotentReplay: true });
  }
}));
api.post("/shuttle/settlements/:id/approve", requireRoles("OWNER", "ADMIN", "SUPER_ADMIN", "CHAIRMAN", "TREASURER"), asyncRoute(async (request, response) => {
  const settlementId = id.parse(request.params.id); const actor = me(request); const settlement = await serializableShuttle(async (tx) => { const changed = await tx.shuttleSettlement.updateMany({ where: { id: settlementId, tenantId: actor.tenantId, status: "DRAFT" }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: actor.id } }); if (changed.count !== 1) throw new HttpError(409, "SETTLEMENT_NOT_DRAFT", "Settlement is unavailable for approval."); const updated = await tx.shuttleSettlement.findUniqueOrThrow({ where: { id: settlementId } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "approve", entityType: "ShuttleSettlement", entityId: updated.id, after: auditSnapshot(updated) } }); return updated; }); response.json(shuttleSettlementJson(settlement));
}));
api.get("/shuttle/settlements", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const settlements = await prisma.shuttleSettlement.findMany({ where: { tenantId: me(request).tenantId }, include: { billingPeriod: true }, orderBy: { billingPeriod: { startsAt: "desc" } }, take: 100 });
  response.json({ data: settlements.map(shuttleSettlementJson) });
}));
api.post("/shuttle/settlements/:id/mark-paid", requireRoles("OWNER", "ADMIN", "SUPER_ADMIN", "TREASURER"), asyncRoute(async (request, response) => {
  const settlementId = id.parse(request.params.id); const input = z.object({ reference: z.string().trim().min(3).max(120) }).strict().parse(request.body); const actor = me(request); const settlement = await serializableShuttle(async (tx) => { const changed = await tx.shuttleSettlement.updateMany({ where: { id: settlementId, tenantId: actor.tenantId, status: "APPROVED" }, data: { status: "PAID", paidAt: new Date(), paidById: actor.id, paymentReference: input.reference } }); if (changed.count !== 1) throw new HttpError(409, "SETTLEMENT_NOT_APPROVED", "Settlement is unavailable for payment marking."); const updated = await tx.shuttleSettlement.findUniqueOrThrow({ where: { id: settlementId } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "mark_paid", entityType: "ShuttleSettlement", entityId: updated.id, after: auditSnapshot(updated) } }); return updated; }); response.json(shuttleSettlementJson(settlement));
}));
api.get("/shuttle/report", requireRoles(...shuttleFinanceRoles), asyncRoute(async (request, response) => {
  const tenantId = me(request).tenantId;
  const [invoices, payments, settlements] = await Promise.all([
    prisma.invoice.findMany({ where: { tenantId, shuttleBillingPeriodId: { not: null }, status: { not: "VOID" } } }),
    prisma.payment.findMany({ where: { tenantId, status: "VERIFIED", invoice: { shuttleBillingPeriodId: { not: null }, status: { not: "VOID" } } } }),
    prisma.shuttleSettlement.findMany({ where: { tenantId } }),
  ]);
  const billed = sumShuttleRupiah(invoices.map((invoice) => invoice.amount));
  const paid = sumShuttleRupiah(payments.map((payment) => payment.amount));
  const vendorShare = sumShuttleRupiah(settlements.map((settlement) => settlement.vendorAmount));
  const cooperativeShare = sumShuttleRupiah(settlements.map((settlement) => settlement.cooperativeAmount));
  response.json({ billed: shuttleRupiahNumber(billed), paid: shuttleRupiahNumber(paid), outstanding: shuttleRupiahNumber(billed - paid), vendorShare: shuttleRupiahNumber(vendorShare), cooperativeShare: shuttleRupiahNumber(cooperativeShare), settlements: settlements.map(shuttleSettlementJson) });
}));

api.get("/catering/orders", asyncRoute(async (request, response) => {
  response.json({ data: decimalJson(await prisma.cateringOrder.findMany({ where: { tenantId: me(request).tenantId }, orderBy: { deliveryAt: "asc" }, take: 100 })) });
}));

api.post("/catering/orders", requireRoles("OWNER", "ADMIN", "CATERING_MANAGER"), asyncRoute(async (request, response) => {
  const input = z.object({ memberId: id.optional(), customerName: z.string().trim().min(2).max(120), deliveryAt: date, items: z.array(z.object({ name: z.string().trim().min(2), quantity: z.coerce.number().int().positive(), unitPrice: money.positive() })).min(1), notes: z.string().trim().max(1000).optional() }).parse(request.body);
  const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const order = await prisma.cateringOrder.create({ data: { tenantId: me(request).tenantId, orderNo: makeReference("CAT"), customerName: input.customerName, memberId: input.memberId, deliveryAt: input.deliveryAt, items: input.items, total, notes: input.notes, status: "CONFIRMED" } });
  await audit(me(request), "create", "CateringOrder", order.id, order);
  response.status(201).json(decimalJson(order));
}));

api.patch("/catering/orders/:id/status", requireRoles("OWNER", "ADMIN", "CATERING_MANAGER"), asyncRoute(async (request, response) => {
  const orderId = id.parse(request.params.id);
  const input = z.object({ status: z.enum(["DRAFT", "CONFIRMED", "PREPARING", "DELIVERED", "CANCELLED"]) }).parse(request.body);
  const order = await prisma.cateringOrder.updateMany({ where: { id: orderId, tenantId: me(request).tenantId }, data: input });
  if (!order.count) throw new HttpError(404, "NOT_FOUND", "Catering order not found.");
  await audit(me(request), "update_status", "CateringOrder", orderId, input);
  response.status(204).end();
}));

api.get("/funding/accounts", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const accounts = await prisma.savingsAccount.findMany({ where: { tenantId: me(request).tenantId }, include: { member: true, entries: { orderBy: { occurredAt: "desc" } } }, orderBy: { accountNo: "asc" } });
  response.json({ data: decimalJson(accounts.map((account) => ({ ...account, balance: account.entries.reduce((sum, entry) => sum + (entry.direction === "CREDIT" ? asNumber(entry.amount) : -asNumber(entry.amount)), 0) }))) });
}));

api.post("/funding/accounts", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const input = z.object({ memberId: id }).parse(request.body);
  const member = await requireEligibleCooperativeMember(input.memberId, me(request).tenantId);
  const account = await prisma.savingsAccount.create({ data: { tenantId: me(request).tenantId, memberId: input.memberId, accountNo: makeReference("SAV") } });
  await audit(me(request), "create", "SavingsAccount", account.id, account);
  response.status(201).json(account);
}));

api.post("/funding/accounts/:id/entries", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const accountId = id.parse(request.params.id);
  const input = z.object({ direction: z.enum(["CREDIT", "DEBIT"]), amount: money.positive(), description: z.string().trim().min(3).max(240), reference: z.string().trim().min(3).max(80).optional() }).parse(request.body);
  const account = await prisma.savingsAccount.findFirst({ where: { id: accountId, tenantId: me(request).tenantId }, include: { entries: true } });
  if (!account) throw new HttpError(404, "NOT_FOUND", "Savings account not found.");
  const balance = account.entries.reduce((sum, entry) => sum + (entry.direction === "CREDIT" ? asNumber(entry.amount) : -asNumber(entry.amount)), 0);
  if (input.direction === "DEBIT" && input.amount > balance) throw new HttpError(409, "INSUFFICIENT_FUNDS", "Withdrawal exceeds the current savings balance.");
  const entry = await prisma.savingsLedgerEntry.create({ data: { accountId, ...input, reference: input.reference ?? makeReference("LED") } });
  await audit(me(request), "post_ledger_entry", "SavingsLedgerEntry", entry.id, entry);
  response.status(201).json(decimalJson(entry));
}));

api.get("/financing/applications", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  response.json({ data: decimalJson(await prisma.financingApplication.findMany({ where: { tenantId: me(request).tenantId }, include: { member: true, receivables: true }, orderBy: { submittedAt: "desc" } })) });
}));

api.post("/financing/applications", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const input = z.object({ memberId: id, purpose: z.string().trim().min(8).max(500), principal: money.positive(), installmentCount: z.coerce.number().int().min(1).max(60), firstDueDate: date }).parse(request.body);
  const member = await requireEligibleCooperativeMember(input.memberId, me(request).tenantId);
  const installment = Math.round((input.principal / input.installmentCount) * 100) / 100;
  const application = await prisma.financingApplication.create({ data: { tenantId: me(request).tenantId, memberId: input.memberId, applicationNo: makeReference("FIN"), purpose: input.purpose, principal: input.principal, outstanding: input.principal, status: "SUBMITTED", submittedAt: new Date(), receivables: { create: Array.from({ length: input.installmentCount }, (_, index) => ({ installmentNo: index + 1, amount: index === input.installmentCount - 1 ? input.principal - installment * (input.installmentCount - 1) : installment, dueDate: new Date(input.firstDueDate.getFullYear(), input.firstDueDate.getMonth() + index, input.firstDueDate.getDate()) })) } }, include: { receivables: true } });
  await audit(me(request), "submit", "FinancingApplication", application.id, application);
  response.status(201).json(decimalJson(application));
}));

api.get("/purchasing/requests", requireRoles("OWNER", "ADMIN", "PROCUREMENT_OFFICER", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  response.json({ data: decimalJson(await prisma.procurementRequest.findMany({ where: { tenantId: me(request).tenantId }, orderBy: { requestedAt: "desc" } })) });
}));

api.post("/purchasing/requests", requireRoles("OWNER", "ADMIN", "PROCUREMENT_OFFICER"), asyncRoute(async (request, response) => {
  const input = z.object({ supplier: z.string().trim().min(2).max(160).optional(), description: z.string().trim().min(8).max(1000), amount: money.positive() }).parse(request.body);
  const purchase = await prisma.procurementRequest.create({ data: { tenantId: me(request).tenantId, requestNo: makeReference("PR"), ...input, status: "REQUESTED" } });
  await audit(me(request), "create", "ProcurementRequest", purchase.id, purchase);
  response.status(201).json(decimalJson(purchase));
}));

api.get("/dashboard", asyncRoute(async (request, response) => {
  const tenantId = me(request).tenantId;
  const [sales, orders, activeSubscriptions, unpaid, products] = await Promise.all([
    prisma.sale.aggregate({ where: { tenantId, status: "COMPLETED" }, _sum: { total: true }, _count: true }),
    prisma.cateringOrder.count({ where: { tenantId, status: { in: ["CONFIRMED", "PREPARING"] } } }),
    prisma.shuttleSubscription.count({ where: { tenantId, status: "ACTIVE" } }),
    prisma.invoice.aggregate({ where: { tenantId, status: "ISSUED" }, _sum: { amount: true } }),
    prisma.product.findMany({ where: { tenantId, active: true }, include: { movements: { select: { quantity: true } } } }),
  ]);
  const lowStock = products.filter((product) => product.movements.reduce((sum, move) => sum + move.quantity, 0) <= product.reorderLevel).map((product) => ({ id: product.id, name: product.name, sku: product.sku, stock: product.movements.reduce((sum, move) => sum + move.quantity, 0), reorderLevel: product.reorderLevel }));
  response.json({ salesRevenue: asNumber(sales._sum.total ?? 0), salesCount: sales._count, openCateringOrders: orders, activeShuttleSubscriptions: activeSubscriptions, outstandingInvoices: asNumber(unpaid._sum.amount ?? 0), lowStock });
}));

api.post("/analytics/demand-forecast", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER", "ANALYST"), asyncRoute(async (request, response) => {
  const input = z.object({ day_of_week: z.coerce.number().int().min(0).max(6), month: z.coerce.number().int().min(1).max(12), active_subscriptions: z.coerce.number().int().min(0), promotion: z.coerce.number().int().min(0).max(1) }).parse(request.body);
  const predictionResponse = await fetch(`${env.ML_SERVICE_URL}/v1/demand/predict`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => undefined);
  if (!predictionResponse?.ok) throw new HttpError(503, "ML_SERVICE_UNAVAILABLE", "The demand model is temporarily unavailable. Please try again later.");
  response.json(await predictionResponse.json());
}));

api.post("/analytics/activity-classification", requireRoles(...activityClassificationRoles), asyncRoute(async (request, response) => {
  const input = activityClassificationInput.parse(request.body);
  let providerResponse: globalThis.Response;
  try {
    providerResponse = await fetch(`${env.ML_SERVICE_URL}/v1/activity-category/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note_deidentified: input.noteDeidentified }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HttpError(504, "ML_SERVICE_TIMEOUT", "The activity suggestion service timed out. Choose a category manually and try again later.");
    }
    throw new HttpError(503, "ML_SERVICE_UNAVAILABLE", "The activity suggestion service is temporarily unavailable. Choose a category manually and try again later.");
  }
  if (!providerResponse.ok) {
    throw new HttpError(503, "ML_SERVICE_UNAVAILABLE", "The activity suggestion service is temporarily unavailable. Choose a category manually and try again later.");
  }

  const rawProviderBody: unknown = await providerResponse.json().catch(() => undefined);
  const parsed = activityClassificationProviderResponse.safeParse(rawProviderBody);
  if (!parsed.success) {
    throw new HttpError(502, "ML_SERVICE_INVALID_RESPONSE", "The activity suggestion service returned an invalid response. Choose a category manually and try again later.");
  }

  const actor = me(request);
  const result = parsed.data;
  await audit(actor, "suggest_activity_category", "ActivityClassificationSuggestion", makeReference("ACTCLS"), {
    predictedCategory: result.predicted_category,
    modelVersion: result.model_version,
    labelVersion: result.label_version,
    inferenceStatus: "SUCCESS",
  });
  response.json({
    predictedCategory: result.predicted_category,
    ...(result.confidence === null ? { decisionScore: result.decision_score } : { confidence: result.confidence }),
    modelVersion: result.model_version,
    labelVersion: result.label_version,
    inferenceStatus: "SUCCESS",
  });
}));
api.get("/knowledge-documents", asyncRoute(async (request, response) => {
  response.json({ data: await prisma.knowledgeDocument.findMany({ where: { tenantId: me(request).tenantId }, orderBy: { updatedAt: "desc" } }) });
}));

api.post("/knowledge-documents", requireRoles("OWNER", "ADMIN", "ANALYST"), asyncRoute(async (request, response) => {
  const input = z.object({ title: z.string().trim().min(3).max(160), content: z.string().trim().min(30).max(20_000), source: z.string().trim().url().optional() }).parse(request.body);
  const document = await prisma.knowledgeDocument.create({ data: { tenantId: me(request).tenantId, ...input } });
  await audit(me(request), "create", "KnowledgeDocument", document.id, { title: document.title });
  response.status(201).json(document);
}));

api.post("/ai/assist", asyncRoute(async (request, response) => {
  const input = z.object({ feature: z.enum(["ORDER_SUMMARY", "MARKETING_COPY", "OPERATIONS_ASSISTANT"]), prompt: z.string().trim().min(5).max(4_000) }).parse(request.body);
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "GENAI_NOT_CONFIGURED", "The generative AI service is not configured. Add a server-side provider key to enable it.");
  const system = "You are NOVO Business Centre's operations assistant. Use Indonesian, be concise, do not invent financial facts, and decline requests outside cooperative operations.";
  const providerResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: env.OPENAI_MODEL, input: [{ role: "system", content: system }, { role: "user", content: input.prompt }] }) });
  if (!providerResponse.ok) throw new HttpError(502, "GENAI_UNAVAILABLE", "The generative AI provider could not complete the request.");
  const payload = await providerResponse.json() as { output_text?: string };
  const answer = payload.output_text?.trim();
  if (!answer) throw new HttpError(502, "GENAI_INVALID_RESPONSE", "The generative AI provider returned no usable response.");
  const record = await prisma.aiInteraction.create({ data: { tenantId: me(request).tenantId, userId: me(request).id, feature: input.feature, prompt: input.prompt, response: answer, model: env.OPENAI_MODEL } });
  response.json({ id: record.id, answer, model: env.OPENAI_MODEL });
}));

api.post("/assistant/chat", asyncRoute(async (request, response) => {
  const input = z.object({ question: z.string().trim().min(3).max(2_000) }).parse(request.body);
  const documents = await prisma.knowledgeDocument.findMany({ where: { tenantId: me(request).tenantId }, select: { id: true, title: true, content: true } });
  const mlResponse = await fetch(`${env.ML_SERVICE_URL}/v1/rag/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: input.question, documents }) }).catch(() => undefined);
  if (!mlResponse?.ok) throw new HttpError(503, "ML_SERVICE_UNAVAILABLE", "The knowledge assistant is temporarily unavailable. Please try again later.");
  const answer = await mlResponse.json() as { answer: string; sources: string[]; intent?: string; retrievalMode: string };
  await prisma.aiInteraction.create({ data: { tenantId: me(request).tenantId, userId: me(request).id, feature: "RAG_CHAT", prompt: input.question, response: answer.answer, model: answer.retrievalMode } });
  response.json(answer);
}));

api.post("/attachments", requireRoles(...writeRoles), upload.single("file"), asyncRoute(async (request, response) => {
  const user = me(request);
  const file = request.file;
  if (!file) throw new HttpError(400, "FILE_REQUIRED", "Attach a PDF, JPEG, PNG, or WEBP file up to 5 MB.");
  let targetPath: string | undefined;
  let retained = false;
  try {
    const input = z.object({ entityType: z.string().trim().min(2).max(80), entityId: z.string().trim().min(2).max(80) }).parse(request.body);
    if (input.entityType === "Payment") {
      const payment = await prisma.payment.findFirst({ where: { id: input.entityId, tenantId: user.tenantId } });
      if (!payment) throw new HttpError(404, "NOT_FOUND", "Payment not found.");
    }
    const bytes = readFileSync(file.path);
    const detectedType = bytes.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf"
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
      : undefined;
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions: Record<string, readonly string[]> = { "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] };
    if (!detectedType || detectedType !== file.mimetype || !allowedExtensions[detectedType]?.includes(extension)) throw new HttpError(400, "INVALID_FILE_SIGNATURE", "The file content does not match an allowed PDF or image type.");
    const filename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "attachment";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${sha256}-${file.filename}`;
    targetPath = path.join(uploadDir, storageKey);
    renameSync(file.path, targetPath);
    const attachment = await prisma.$transaction(async (tx) => { const created = await tx.attachment.create({ data: { tenantId: user.tenantId, uploadedById: user.id, ...input, filename, contentType: file.mimetype, size: file.size, storageKey, sha256 } }); await tx.auditLog.create({ data: { tenantId: user.tenantId, actorId: user.id, action: "upload", entityType: "Attachment", entityId: created.id, after: { entityType: input.entityType, entityId: input.entityId, sha256 } } }); return created; });
    retained = true;
    response.status(201).json({ id: attachment.id, entityType: attachment.entityType, entityId: attachment.entityId, filename: attachment.filename, contentType: attachment.contentType, size: attachment.size, createdAt: attachment.createdAt });
  } finally {
    if (!retained) {
      if (targetPath && existsSync(targetPath)) unlinkSync(targetPath);
      if (existsSync(file.path)) unlinkSync(file.path);
    }
  }
}));


api.get("/attachments/:id/download", asyncRoute(async (request, response) => {
  const attachmentId = id.parse(request.params.id);
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, tenantId: me(request).tenantId } });
  if (!attachment) throw new HttpError(404, "NOT_FOUND", "Attachment not found.");
  if (attachment.entityType === "Payment" && !["OWNER", "ADMIN", "SUPER_ADMIN", "TREASURER", "FINANCE_OFFICER", "CASHIER", "AUDITOR"].includes(me(request).role)) throw new HttpError(403, "FORBIDDEN", "Payment proof access is not permitted for this role.");
  const filePath = path.resolve(uploadDir, attachment.storageKey);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`) || !existsSync(filePath)) throw new HttpError(404, "FILE_NOT_FOUND", "Attachment binary is unavailable.");
  response.type(attachment.contentType);
  response.download(filePath, attachment.filename);
}));
api.get("/audit-logs", requireRoles("OWNER", "ADMIN", "ANALYST"), asyncRoute(async (request, response) => {
  response.json({ data: await prisma.auditLog.findMany({ where: { tenantId: me(request).tenantId }, include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 200 }) });
}));

app.use("/api/v1", api);
app.use((_request, _response, next) => next(new HttpError(404, "NOT_FOUND", "Route not found.")));
app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  console.error("request failed", error);
  if (error instanceof z.ZodError) return response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the submitted fields.", details: error.flatten() } });
  if (error instanceof HttpError) return response.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  if (error instanceof multer.MulterError) return response.status(400).json({ error: { code: "INVALID_IMPORT_UPLOAD", message: "Upload one .xlsx workbook within the permitted size limit." } });
  if (isActiveShuttleSubscriptionUniqueConflict(error)) return response.status(409).json({ error: { code: "DUPLICATE_ACTIVE_SUBSCRIPTION", message: "This rider already has an active subscription for the route." } });
  if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "P2002") return response.status(409).json({ error: { code: "DUPLICATE_RECORD", message: "A record with that identifier already exists." } });
  if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "P2034") return response.status(409).json({ error: { code: "IMPORT_CONFLICT", message: "The import changed concurrently. Refresh the preview and try again." } });
  return response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
});

export { app };



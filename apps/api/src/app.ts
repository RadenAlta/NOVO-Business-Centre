import type { UserRole } from "./roles.js";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import multer from "multer";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { audit } from "./audit.js";
import { authenticate, clearSessionCookie, createBrowserSession, requireCsrf, requireRoles, requireTrustedOrigin, issueCsrfToken, revokeSessionForLogout, setSessionCookie } from "./auth.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { asNumber, asyncRoute, HttpError, makeReference } from "./lib.js";
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
api.get("/products", requireRoles(...storeReadRoles), asyncRoute(async (request, response) => {
  const query = storeProductQuery.parse(request.query); const where = { tenantId: me(request).tenantId, ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.active ? { active: query.active === "true" } : {}), ...(query.q ? { OR: [{ sku: { contains: query.q, mode: "insensitive" as const } }, { name: { contains: query.q, mode: "insensitive" as const } }] } : {}) };
  const rows = await prisma.product.findMany({ where, include: { category: { select: { id: true, name: true, active: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] }); const filtered = query.lowStock ? rows.filter((product) => product.stockOnHand <= product.reorderLevel) : rows; const data = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((product) => ({ ...decimalJson(product), stock: product.stockOnHand, lowStock: product.stockOnHand <= product.reorderLevel })); response.json({ data, pagination: storePage(query.page, query.pageSize, filtered.length) });
}));

const storeProductInput = z.object({ sku: z.string().trim().min(2).max(50), name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).nullable().optional(), categoryId: id.nullable().optional(), unitPrice: money.positive(), unitCost: money.nullable().optional(), reorderLevel: z.coerce.number().int().min(0).max(1000000).default(0), initialStock: z.coerce.number().int().min(0).max(1000000).default(0), active: z.boolean().optional() }).strict();
const storeProductPatch = storeProductInput.omit({ initialStock: true }).partial().refine((value) => Object.keys(value).length > 0);
async function storeCategoryId(tx: Prisma.TransactionClient, tenantId: string, categoryId: string | null | undefined): Promise<string | null | undefined> { if (categoryId === undefined || categoryId === null) return categoryId; const category = await tx.productCategory.findFirst({ where: { id: categoryId, tenantId, active: true }, select: { id: true } }); if (!category) throw new HttpError(400, "INVALID_CATEGORY", "Category must be active and belong to this workspace."); return category.id; }
api.post("/products", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => { const input = storeProductInput.parse(request.body); const actor = me(request); const product = await serializableStore(async (tx) => { const categoryId = await storeCategoryId(tx, actor.tenantId, input.categoryId); const created = await tx.product.create({ data: { tenantId: actor.tenantId, sku: input.sku.toUpperCase(), name: input.name, description: input.description ?? null, categoryId: categoryId ?? null, unitPrice: new Prisma.Decimal(input.unitPrice), unitCost: input.unitCost === undefined || input.unitCost === null ? null : new Prisma.Decimal(input.unitCost), reorderLevel: input.reorderLevel, stockOnHand: input.initialStock, active: input.active ?? true } }); if (input.initialStock) await tx.stockMovement.create({ data: { tenantId: actor.tenantId, productId: created.id, quantity: input.initialStock, reason: "INITIAL_STOCK", reference: makeReference("STK"), balanceAfter: input.initialStock, performedById: actor.id } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "create", entityType: "Product", entityId: created.id, after: { sku: created.sku, initialStock: input.initialStock } } }); return created; }); response.status(201).json(decimalJson(product)); }));
api.patch("/products/:id", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => { const productId = id.parse(request.params.id); const input = storeProductPatch.parse(request.body); const actor = me(request); const product = await serializableStore(async (tx) => { const current = await tx.product.findFirst({ where: { id: productId, tenantId: actor.tenantId } }); if (!current) throw new HttpError(404, "NOT_FOUND", "Product not found."); const categoryId = await storeCategoryId(tx, actor.tenantId, input.categoryId); const updated = await tx.product.update({ where: { id: current.id }, data: { ...(input.sku === undefined ? {} : { sku: input.sku.toUpperCase() }), ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description }), ...(categoryId === undefined ? {} : { categoryId }), ...(input.unitPrice === undefined ? {} : { unitPrice: new Prisma.Decimal(input.unitPrice) }), ...(input.unitCost === undefined ? {} : { unitCost: input.unitCost === null ? null : new Prisma.Decimal(input.unitCost) }), ...(input.reorderLevel === undefined ? {} : { reorderLevel: input.reorderLevel }), ...(input.active === undefined ? {} : { active: input.active }) } }); await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "update", entityType: "Product", entityId: updated.id, after: { sku: updated.sku, active: updated.active } } }); return updated; }); response.json(decimalJson(product)); }));
api.post("/products/:id/receipts", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => { const productId=id.parse(request.params.id); const input=z.object({ quantity:z.coerce.number().int().positive().max(1000000), reference:z.string().trim().min(3).max(80).optional(), unitCost:money.nullable().optional() }).strict().parse(request.body); const actor=me(request); const movement=await serializableStore(async(tx)=>{ const product=await tx.product.findFirst({where:{id:productId,tenantId:actor.tenantId}}); if(!product)throw new HttpError(404,"NOT_FOUND","Product not found."); const updated=await tx.product.update({where:{id:product.id},data:{stockOnHand:{increment:input.quantity},...(input.unitCost===undefined?{}:{unitCost:input.unitCost===null?null:new Prisma.Decimal(input.unitCost)})},select:{stockOnHand:true}}); const created=await tx.stockMovement.create({data:{tenantId:actor.tenantId,productId:product.id,quantity:input.quantity,reason:"STOCK_RECEIPT",reference:input.reference??makeReference("RCV"),balanceAfter:updated.stockOnHand,performedById:actor.id}}); await tx.auditLog.create({data:{tenantId:actor.tenantId,actorId:actor.id,action:"receive_stock",entityType:"Product",entityId:product.id,after:{movementId:created.id,quantity:input.quantity,balanceAfter:updated.stockOnHand}}});return created;});response.status(201).json(movement);}));
api.post("/products/:id/adjustments", requireRoles(...storeManageRoles), asyncRoute(async (request, response) => {
  const productId = id.parse(request.params.id);
  const input = z.object({ quantity: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, "Quantity cannot be zero."), reason: z.string().trim().min(3).max(160), reference: z.string().trim().min(3).max(80).optional() }).strict().parse(request.body);
  const actor = me(request);
  const movement = await serializableStore(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, tenantId: actor.tenantId }, select: { id: true } });
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found.");
    let stockOnHand: number;
    if (input.quantity < 0) {
      const updated = await tx.product.updateMany({ where: { id: product.id, tenantId: actor.tenantId, stockOnHand: { gte: Math.abs(input.quantity) } }, data: { stockOnHand: { decrement: Math.abs(input.quantity) } } });
      if (updated.count !== 1) throw new HttpError(409, "INSUFFICIENT_STOCK", "Stock adjustment cannot make inventory negative.");
      stockOnHand = (await tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { stockOnHand: true } })).stockOnHand;
    } else {
      stockOnHand = (await tx.product.update({ where: { id: product.id }, data: { stockOnHand: { increment: input.quantity } }, select: { stockOnHand: true } })).stockOnHand;
    }
    const created = await tx.stockMovement.create({ data: { tenantId: actor.tenantId, productId: product.id, quantity: input.quantity, reason: "STOCK_ADJUSTMENT: " + input.reason, reference: input.reference ?? makeReference("ADJ"), balanceAfter: stockOnHand, performedById: actor.id } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, actorId: actor.id, action: "adjust_stock", entityType: "Product", entityId: product.id, after: { movementId: created.id, quantity: input.quantity, reason: input.reason, balanceAfter: stockOnHand } } });
    return created;
  });
  response.status(201).json(movement);
}));

api.get("/products/:id/movements", requireRoles(...storeReadRoles), asyncRoute(async(request,response)=>{const productId=id.parse(request.params.id);const query=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);const actor=me(request);if(!await prisma.product.findFirst({where:{id:productId,tenantId:actor.tenantId},select:{id:true}}))throw new HttpError(404,"NOT_FOUND","Product not found.");const where={tenantId:actor.tenantId,productId};const [total,data]=await prisma.$transaction([prisma.stockMovement.count({where}),prisma.stockMovement.findMany({where,include:{performedBy:{select:{name:true}}},orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(query.page-1)*query.pageSize,take:query.pageSize})]);response.json({data,pagination:storePage(query.page,query.pageSize,total)});}));

const storeSaleQuery = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(["COMPLETED", "VOIDED"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict();
api.get("/sales", requireRoles(...storeReadRoles), asyncRoute(async (request, response) => { const query=storeSaleQuery.parse(request.query); const where={tenantId:me(request).tenantId,...(query.status?{status:query.status}:{}),...(query.q?{receiptNo:{contains:query.q,mode:"insensitive" as const}}:{})}; const [total,data]=await prisma.$transaction([prisma.sale.count({where}),prisma.sale.findMany({where,include:storeSaleInclude,orderBy:[{occurredAt:"desc"},{id:"desc"}],skip:(query.page-1)*query.pageSize,take:query.pageSize})]); response.json({data:data.map((sale)=>storeSaleResponse(sale,storeHppRoles.includes(me(request).role))),pagination:storePage(query.page,query.pageSize,total)}); }));

const storeCheckoutInput = z.object({ paymentMethod: z.enum(["CASH", "TRANSFER", "QRIS"]), cashReceived: money.optional(), paymentReference: z.string().trim().min(3).max(100).optional(), customerIdentityId: id.optional(), items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive().max(999) }).strict()).min(1).max(50) }).strict().superRefine((input, context) => {
  if (input.paymentMethod === "CASH" && input.cashReceived === undefined) context.addIssue({ code: "custom", path: ["cashReceived"], message: "Cash received is required." });
  if (input.paymentMethod !== "CASH" && !input.paymentReference) context.addIssue({ code: "custom", path: ["paymentReference"], message: "A transfer or QRIS reference is required." });
});
const storeSaleInclude = { items: { include: { product: { select: { sku: true, name: true } } } }, payment: true, cashier: { select: { name: true } } } satisfies Prisma.SaleInclude;
const storeHppRoles: UserRole[] = ["OWNER", "ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER", "TREASURER", "AUDITOR"];
type StoreSalePayload = Prisma.SaleGetPayload<{ include: typeof storeSaleInclude }>;
function storeSaleResponse(sale: StoreSalePayload, includeHpp: boolean) { const base={id:sale.id,receiptNo:sale.receiptNo,status:sale.status,paymentMethod:sale.paymentMethod,total:asNumber(sale.total),occurredAt:sale.occurredAt,voidReason:sale.voidReason,voidedAt:sale.voidedAt,cashier:sale.cashier,payment:sale.payment===null?null:{method:sale.payment.method,status:sale.payment.status,amount:asNumber(sale.payment.amount),cashReceived:sale.payment.cashReceived===null?null:asNumber(sale.payment.cashReceived),changeGiven:sale.payment.changeGiven===null?null:asNumber(sale.payment.changeGiven),reference:sale.payment.reference,recordedAt:sale.payment.recordedAt}};const items=sale.items.map((item)=>({id:item.id,productId:item.productId,sku:item.productSku,name:item.productName,quantity:item.quantity,unitPrice:asNumber(item.unitPrice),subtotal:asNumber(item.subtotal),...(includeHpp?{unitCost:item.unitCost===null?null:asNumber(item.unitCost),costSubtotal:item.costSubtotal===null?null:asNumber(item.costSubtotal),grossMargin:item.grossMargin===null?null:asNumber(item.grossMargin)}:{})}));return {...base,items,...(includeHpp?{totalCost:sale.totalCost===null?null:asNumber(sale.totalCost),grossMargin:sale.grossMargin===null?null:asNumber(sale.grossMargin)}:{})}; }

async function serializableStore<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue; throw error; }
  }
  throw new HttpError(409, "STORE_CONCURRENT_CONFLICT", "Inventory changed concurrently. Refresh the cart and try again.");
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

api.get("/shuttle/routes", asyncRoute(async (request, response) => {
  response.json({ data: decimalJson(await prisma.shuttleRoute.findMany({ where: { tenantId: me(request).tenantId }, orderBy: { name: "asc" } })) });
}));

api.post("/shuttle/routes", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER"), asyncRoute(async (request, response) => {
  const input = z.object({ code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(120), stops: z.array(z.string().trim().min(2)).min(2).max(30), monthlyRate: money.positive() }).parse(request.body);
  const route = await prisma.shuttleRoute.create({ data: { ...input, tenantId: me(request).tenantId } });
  await audit(me(request), "create", "ShuttleRoute", route.id, route);
  response.status(201).json(decimalJson(route));
}));

api.get("/shuttle/subscriptions", asyncRoute(async (request, response) => {
  const data = await prisma.shuttleSubscription.findMany({ where: { tenantId: me(request).tenantId }, include: { member: true, route: true, invoices: true }, orderBy: { startDate: "desc" } });
  response.json({ data: decimalJson(data) });
}));

api.post("/shuttle/subscriptions", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER"), asyncRoute(async (request, response) => {
  const input = z.object({ memberId: id, routeId: id, startDate: date, endDate: date.optional() }).parse(request.body);
  const [member, route] = await Promise.all([
    requireEligibleCooperativeMember(input.memberId, me(request).tenantId),
    prisma.shuttleRoute.findFirst({ where: { id: input.routeId, tenantId: me(request).tenantId, active: true } }),
  ]);
  if (!member || !route) throw new HttpError(400, "INVALID_SUBSCRIPTION", "Member or route is unavailable.");
  const subscription = await prisma.shuttleSubscription.create({ data: { ...input, tenantId: me(request).tenantId } });
  await audit(me(request), "create", "ShuttleSubscription", subscription.id, subscription);
  response.status(201).json(subscription);
}));

api.post("/shuttle/subscriptions/:id/invoices", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const subscriptionId = id.parse(request.params.id);
  const input = z.object({ dueDate: date.optional(), amount: money.positive().optional() }).parse(request.body);
  const subscription = await prisma.shuttleSubscription.findFirst({ where: { id: subscriptionId, tenantId: me(request).tenantId }, include: { route: true } });
  if (!subscription) throw new HttpError(404, "NOT_FOUND", "Subscription not found.");
  const invoice = await prisma.invoice.create({ data: { tenantId: me(request).tenantId, subscriptionId, invoiceNo: makeReference("INV"), description: `Shuttle subscription: ${subscription.route.name}`, amount: input.amount ?? asNumber(subscription.route.monthlyRate), dueDate: input.dueDate, status: "ISSUED", issuedAt: new Date() } });
  await audit(me(request), "issue", "Invoice", invoice.id, invoice);
  response.status(201).json(decimalJson(invoice));
}));

api.get("/billing/invoices", requireRoles("OWNER", "ADMIN", "FLEET_MANAGER", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  response.json({ data: decimalJson(await prisma.invoice.findMany({ where: { tenantId: me(request).tenantId }, include: { payments: true, subscription: { include: { member: true, route: true } } }, orderBy: { issuedAt: "desc" }, take: 100 })) });
}));

api.post("/billing/invoices/:id/payments", requireRoles("OWNER", "ADMIN", "FINANCE_OFFICER"), asyncRoute(async (request, response) => {
  const invoiceId = id.parse(request.params.id);
  const input = z.object({ amount: money.positive(), method: paymentMethod, reference: z.string().trim().min(3).max(80) }).parse(request.body);
  const payment = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId: me(request).tenantId }, include: { payments: true } });
    if (!invoice || invoice.status === "VOID") throw new HttpError(404, "NOT_FOUND", "Invoice not found.");
    const paid = invoice.payments.reduce((sum, item) => sum + asNumber(item.amount), 0);
    if (paid + input.amount > asNumber(invoice.amount)) throw new HttpError(409, "OVERPAYMENT", "Payment exceeds the remaining invoice amount.");
    const created = await tx.payment.create({ data: { tenantId: me(request).tenantId, invoiceId, ...input } });
    if (paid + input.amount === asNumber(invoice.amount)) await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
    return created;
  });
  await audit(me(request), "record_payment", "Payment", payment.id, payment);
  response.status(201).json(decimalJson(payment));
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
  const input = z.object({ entityType: z.string().trim().min(2).max(80), entityId: z.string().trim().min(2).max(80) }).parse(request.body);
  if (!request.file) throw new HttpError(400, "FILE_REQUIRED", "Attach a PDF, JPEG, PNG, or WEBP file up to 5 MB.");
  const bytes = readFileSync(request.file.path);
  const detectedType = bytes.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf"
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
    : undefined;
  if (!detectedType || detectedType !== request.file.mimetype) {
    unlinkSync(request.file.path);
    throw new HttpError(400, "INVALID_FILE_SIGNATURE", "The file content does not match an allowed PDF or image type.");
  }
  const filename = path.basename(request.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "attachment";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${sha256}-${request.file.filename}`;
  renameSync(request.file.path, path.join(uploadDir, storageKey));
  const attachment = await prisma.attachment.create({ data: { tenantId: user.tenantId, uploadedById: user.id, ...input, filename, contentType: request.file.mimetype, size: request.file.size, storageKey, sha256 } });  await audit(user, "upload", "Attachment", attachment.id, { entityType: input.entityType, entityId: input.entityId });
  response.status(201).json(attachment);
}));


api.get("/attachments/:id/download", asyncRoute(async (request, response) => {
  const attachmentId = id.parse(request.params.id);
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, tenantId: me(request).tenantId } });
  if (!attachment) throw new HttpError(404, "NOT_FOUND", "Attachment not found.");
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
  if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "P2002") return response.status(409).json({ error: { code: "DUPLICATE_RECORD", message: "A record with that identifier already exists." } });
  if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "P2034") return response.status(409).json({ error: { code: "IMPORT_CONFLICT", message: "The import changed concurrently. Refresh the preview and try again." } });
  return response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
});

export { app };



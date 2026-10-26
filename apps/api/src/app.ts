import type { UserRole } from "./roles.js";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import multer from "multer";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";

import type { Prisma } from "@prisma/client";
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
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "X-Novo-Csrf"], maxAge: 600 }));
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
  const updated = await prisma.masterDataRecord.updateMany({ where: { id: recordId, tenantId: me(request).tenantId }, data: input });
  if (!updated.count) throw new HttpError(404, "NOT_FOUND", "Master data record not found.");
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
  const identity = await prisma.masterDataRecord.findFirst({ where: { id: input.identityId, tenantId: me(request).tenantId }, select: { id: true, type: true, active: true, fullName: true, email: true, phone: true } });
  if (!identity || identity.type === "STUDENT" || !identity.active) {
    throw new HttpError(400, "INELIGIBLE_MEMBER_IDENTITY", "Only an active teacher or employee identity from this tenant may become a cooperative member.");
  }
  const member = await prisma.cooperativeMember.create({ data: { tenantId: me(request).tenantId, identityId: identity.id, memberNo: normalizeIdentifier(input.memberNo), name: identity.fullName, email: identity.email, phone: identity.phone } });
  await audit(me(request), "create", "CooperativeMember", member.id, { memberNo: member.memberNo, identityId: member.identityId, active: member.active });
  response.status(201).json(member);
}));

api.patch("/members/:id/active", requireRoles(...adminRoles), asyncRoute(async (request, response) => {
  const memberId = id.parse(request.params.id);
  const input = z.object({ active: z.boolean() }).strict().parse(request.body);
  const member = await prisma.cooperativeMember.findFirst({
    where: { id: memberId, tenantId: me(request).tenantId },
    include: { identity: { select: { id: true, type: true, active: true } } },
  });
  if (!member) throw new HttpError(404, "NOT_FOUND", "Cooperative member not found.");
  if (input.active && (!member.identity || !member.identity.active || member.identity.type === "STUDENT")) {
    throw new HttpError(400, "INELIGIBLE_MEMBER_IDENTITY", "Only an active teacher or employee identity may have an active cooperative membership.");
  }
  await prisma.cooperativeMember.update({ where: { id: member.id }, data: input });
  await audit(me(request), input.active ? "activate" : "deactivate", "CooperativeMember", member.id, { memberNo: member.memberNo, identityId: member.identityId, active: input.active });
  response.status(204).end();
}));
api.get("/products", asyncRoute(async (request, response) => {
  const products = await prisma.product.findMany({
    where: { tenantId: me(request).tenantId },
    include: { movements: { select: { quantity: true } } },
    orderBy: { name: "asc" },
  });
  response.json({ data: products.map(({ movements, ...product }) => ({ ...decimalJson(product), stock: movements.reduce((total, move) => total + move.quantity, 0) })) });
}));

api.post("/products", requireRoles(...writeRoles), asyncRoute(async (request, response) => {
  const input = z.object({ sku: z.string().trim().min(2).max(50), name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).optional(), unitPrice: money.positive(), reorderLevel: z.coerce.number().int().min(0).default(0), initialStock: z.coerce.number().int().min(0).default(0) }).parse(request.body);
  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: { tenantId: me(request).tenantId, sku: input.sku, name: input.name, description: input.description, unitPrice: input.unitPrice, reorderLevel: input.reorderLevel } });
    if (input.initialStock > 0) await tx.stockMovement.create({ data: { tenantId: me(request).tenantId, productId: created.id, quantity: input.initialStock, reason: "INITIAL_STOCK", reference: makeReference("STK") } });
    return created;
  });
  await audit(me(request), "create", "Product", product.id, product);
  response.status(201).json(decimalJson(product));
}));

api.post("/products/:id/adjustments", requireRoles(...writeRoles), asyncRoute(async (request, response) => {
  const productId = id.parse(request.params.id);
  const input = z.object({ quantity: z.coerce.number().int().refine((value) => value !== 0, "Quantity cannot be zero."), reason: z.string().trim().min(3).max(160), reference: z.string().trim().max(80).optional() }).parse(request.body);
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId: me(request).tenantId } });
  if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found.");
  const movement = await prisma.stockMovement.create({ data: { tenantId: me(request).tenantId, productId, quantity: input.quantity, reason: input.reason, reference: input.reference ?? makeReference("ADJ") } });
  await audit(me(request), "adjust_stock", "Product", product.id, movement);
  response.status(201).json(movement);
}));

api.get("/sales", requireRoles(...writeRoles), asyncRoute(async (request, response) => {
  const sales = await prisma.sale.findMany({ where: { tenantId: me(request).tenantId }, include: { items: { include: { product: { select: { sku: true, name: true } } } }, cashier: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 100 });
  response.json({ data: decimalJson(sales) });
}));

api.post("/sales", requireRoles("OWNER", "ADMIN", "CASHIER"), asyncRoute(async (request, response) => {
  const input = z.object({ paymentMethod, items: z.array(z.object({ productId: id, quantity: z.coerce.number().int().positive().max(999) })).min(1).max(50) }).parse(request.body);
  const quantities = new Map<string, number>();
  for (const line of input.items) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  const sale = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { tenantId: me(request).tenantId, id: { in: [...quantities.keys()] }, active: true }, include: { movements: { select: { quantity: true } } } });
    if (products.length !== quantities.size) throw new HttpError(400, "INVALID_PRODUCT", "One or more products are unavailable.");
    const byId = new Map(products.map((product) => [product.id, product]));
    const items = [...quantities.entries()].map(([productId, quantity]) => {
      const product = byId.get(productId);
      if (!product) throw new HttpError(400, "INVALID_PRODUCT", "Product is unavailable.");
      const stock = product.movements.reduce((sum, movement) => sum + movement.quantity, 0);
      if (stock < quantity) throw new HttpError(409, "INSUFFICIENT_STOCK", `${product.name} has only ${stock} unit(s) in stock.`);
      const unitPrice = asNumber(product.unitPrice);
      return { productId, quantity, unitPrice, subtotal: unitPrice * quantity };
    });
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    const created = await tx.sale.create({ data: { tenantId: me(request).tenantId, cashierId: me(request).id, receiptNo: makeReference("POS"), paymentMethod: input.paymentMethod, total, items: { create: items } }, include: { items: true } });
    await tx.stockMovement.createMany({ data: items.map((item) => ({ tenantId: me(request).tenantId, productId: item.productId, quantity: -item.quantity, reason: "POS_SALE", reference: created.receiptNo })) });
    return created;
  });
  await audit(me(request), "checkout", "Sale", sale.id, { receiptNo: sale.receiptNo, total: sale.total.toString() });
  response.status(201).json(decimalJson(sale));
}));

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



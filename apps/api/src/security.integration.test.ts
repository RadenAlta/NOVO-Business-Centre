import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "./app.js";
import { hashSecret } from "./auth.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { masterDataColumns, toExcelJsBuffer } from "./master-data-import.js";

const origin = "http://localhost:5173";
const testDatabase = process.env.DATABASE_URL ?? "";

if (process.env.NODE_ENV !== "test" || !/\/novo_(?:ci|test)(?:\?|$)/.test(testDatabase)) {
  throw new Error("Security integration tests require NODE_ENV=test and a disposable DATABASE_URL named novo_ci or novo_test.");
}

type TestAccount = { tenantId: string; slug: string; userId: string; email: string; password: string };

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const first = Array.isArray(header) ? header[0] : header;
  if (!first) throw new Error("Expected session cookie.");
  return first.split(";", 1)[0] ?? "";
}

function binaryResponseParser(response: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.once("end", () => callback(null, Buffer.concat(chunks)));
  response.once("error", (error: Error) => callback(error, Buffer.alloc(0)));
}

async function clearTestData(): Promise<void> {
  await prisma.storePayment.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.savingsLedgerEntry.deleteMany();
  await prisma.savingsAccount.deleteMany();
  await prisma.cooperativeMember.deleteMany();
  await prisma.masterDataImportPreview.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.masterDataRecord.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

async function createAccount(slug: string, role: "ADMIN" | "VIEWER" = "ADMIN"): Promise<TestAccount> {
  const tenant = await prisma.tenant.create({ data: { name: `Tenant ${slug}`, slug } });
  const email = `${slug}@example.test`;
  const password = "SecurityPass123!";
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, name: `User ${slug}`, passwordHash: await bcrypt.hash(password, 4), role },
  });
  return { tenantId: tenant.id, slug, userId: user.id, email, password };
}

async function login(agent: ReturnType<typeof request.agent>, account: TestAccount): Promise<request.Response> {
  return agent.post("/api/v1/auth/login").set("Origin", origin).send({ tenantSlug: account.slug, email: account.email, password: account.password }).expect(200);
}

async function createTenantUser(account: TestAccount, emailPrefix: string, role: "ADMIN" | "VIEWER" = "ADMIN"): Promise<TestAccount> {
  const email = `${emailPrefix}@example.test`;
  const password = "SecurityPass123!";
  const user = await prisma.user.create({
    data: { tenantId: account.tenantId, email, name: `User ${emailPrefix}`, passwordHash: await bcrypt.hash(password, 4), role },
  });
  return { tenantId: account.tenantId, slug: account.slug, userId: user.id, email, password };
}

const cooperativeMemberAuditFailureSql = {
  create: `CREATE OR REPLACE FUNCTION novo_fail_cooperative_member_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW."entityType" = ''CooperativeMember'' AND NEW.action = ''create'' THEN RAISE EXCEPTION ''forced cooperative-member audit failure''; END IF; RETURN NEW; END;'`,
  deactivate: `CREATE OR REPLACE FUNCTION novo_fail_cooperative_member_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW."entityType" = ''CooperativeMember'' AND NEW.action = ''deactivate'' THEN RAISE EXCEPTION ''forced cooperative-member audit failure''; END IF; RETURN NEW; END;'`,
} as const;

async function withFailingCooperativeMemberAudit(action: keyof typeof cooperativeMemberAuditFailureSql, callback: () => Promise<void>): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS novo_fail_cooperative_member_audit_trigger ON "AuditLog";');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS novo_fail_cooperative_member_audit();');
  try {
    await prisma.$executeRawUnsafe(cooperativeMemberAuditFailureSql[action]);
    await prisma.$executeRawUnsafe('CREATE TRIGGER novo_fail_cooperative_member_audit_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION novo_fail_cooperative_member_audit();');
    await callback();
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS novo_fail_cooperative_member_audit_trigger ON "AuditLog";');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS novo_fail_cooperative_member_audit();');
  }
}

beforeEach(async () => {
  await mkdir(path.resolve(env.UPLOAD_DIR), { recursive: true });
  await clearTestData();
});

afterEach(async () => {
  await clearTestData();
});

afterAll(async () => {
  await rm(path.resolve(env.UPLOAD_DIR), { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("revocable browser sessions", () => {
  it("bootstraps with an HttpOnly opaque cookie and never returns a bearer token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/bootstrap")
      .set("Origin", origin)
      .send({ tenantName: "Bootstrap Tenant", slug: "bootstrap-tenant", ownerName: "Bootstrap Owner", email: "owner@bootstrap.test", password: "BootstrapPass123!" })
      .expect(201);

    expect(response.body).toMatchObject({ user: { email: "owner@bootstrap.test" }, tenant: { slug: "bootstrap-tenant" } });
    expect(response.body).not.toHaveProperty("token");
    expect(response.body.csrfToken).toEqual(expect.any(String));
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");

    const rawCookie = cookieFrom(response).replace("novo_session=", "");
    const session = await prisma.userSession.findUnique({ where: { tokenHash: hashSecret(rawCookie) } });
    expect(session?.tokenHash).not.toBe(rawCookie);
    expect(session?.csrfTokenHash).not.toBe(response.body.csrfToken);

    await request(app).post("/api/v1/auth/bootstrap").set("Origin", origin).send({ tenantName: "Second Tenant", slug: "second-tenant", ownerName: "Second Owner", email: "owner@second.test", password: "SecondOwnerPass123!" }).expect(409);
  });

  it("reloads through /me, revokes logout server-side, and rejects a replayed cookie", async () => {
    const account = await createAccount("session-tenant");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const oldCookie = cookieFrom(signedIn);

    const me = await agent.get("/api/v1/me").expect(200);
    expect(me.body).toMatchObject({ user: { id: account.userId, tenantId: account.tenantId }, tenant: { slug: account.slug } });
    expect(me.body.csrfToken).toEqual(expect.any(String));

    await agent.post("/api/v1/auth/logout").set("Origin", origin).set("X-Novo-Csrf", me.body.csrfToken).expect(204);
    await request(app).get("/api/v1/me").set("Cookie", oldCookie).expect(401);
    await agent.post("/api/v1/auth/logout").set("Origin", origin).expect(204);
  });

  it("keeps concurrent /me CSRF responses usable for subsequent writes", async () => {
    const account = await createAccount("csrf-concurrency");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const rawToken = cookieFrom(signedIn).replace("novo_session=", "");

    // Simulate a session issued before the stable-CSRF migration, then overlap two session restores.
    await prisma.userSession.update({ where: { tokenHash: hashSecret(rawToken) }, data: { csrfToken: null } });
    const [first, second] = await Promise.all([agent.get("/api/v1/me").expect(200), agent.get("/api/v1/me").expect(200)]);
    expect(first.body.csrfToken).toEqual(second.body.csrfToken);

    await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", first.body.csrfToken).send({ type: "EMPLOYEE", identifier: "CSRF-RACE-1", fullName: "Concurrent Session One" }).expect(201);
    await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", second.body.csrfToken).send({ type: "EMPLOYEE", identifier: "CSRF-RACE-2", fullName: "Concurrent Session Two" }).expect(201);
  });
  it("rejects bearer-only, altered, and expired browser session credentials", async () => {
    const account = await createAccount("tamper-tenant");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const cookie = cookieFrom(signedIn);
    const rawToken = cookie.replace("novo_session=", "");

    await request(app).get("/api/v1/me").set("Authorization", `Bearer ${rawToken}`).expect(401);
    await request(app).get("/api/v1/me").set("Cookie", "novo_session=altered-value").expect(401);
    await prisma.userSession.update({ where: { tokenHash: hashSecret(rawToken) }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(app).get("/api/v1/me").set("Cookie", cookie).expect(401);
  });
});

describe("CSRF, current RBAC, and tenant isolation", () => {
  it("requires a session-bound CSRF token and trusted origin for writes, including multipart upload", async () => {
    const account = await createAccount("csrf-tenant");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrfToken = signedIn.body.csrfToken as string;

    await agent.post("/api/v1/master-data").set("Origin", origin).send({ type: "EMPLOYEE", identifier: "EMP-001", fullName: "Synthetic Employee" }).expect(403);
    await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", "wrong-token").send({ type: "EMPLOYEE", identifier: "EMP-001", fullName: "Synthetic Employee" }).expect(403);
    await agent.post("/api/v1/master-data").set("Origin", "https://attacker.example").set("X-Novo-Csrf", csrfToken).send({ type: "EMPLOYEE", identifier: "EMP-001", fullName: "Synthetic Employee" }).expect(403);
    await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ type: "EMPLOYEE", identifier: "EMP-001", fullName: "Synthetic Employee" }).expect(201);
    await agent.get("/api/v1/master-data").expect(200);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await agent.post("/api/v1/attachments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .field("entityType", "MasterDataRecord")
      .field("entityId", "synthetic-employee")
      .attach("file", png, { filename: "receipt.png", contentType: "image/png" })
      .expect(201);
  });

  it("uses the database role and tenant on every request", async () => {
    const tenantA = await createAccount("tenant-a");
    const tenantB = await createAccount("tenant-b");
    const privateRecord = await prisma.masterDataRecord.create({ data: { tenantId: tenantA.tenantId, type: "EMPLOYEE", identifier: "A-PRIVATE", fullName: "Tenant A Only", dataSource: "TEST" } });
    const agent = request.agent(app);
    const signedIn = await login(agent, tenantB);
    const csrfToken = signedIn.body.csrfToken as string;

    const emptyPage = await agent.get("/api/v1/master-data").expect(200);
    expect(emptyPage.body).toMatchObject({ data: [], pagination: { page: 1, pageSize: 50, total: 0, pageCount: 0 } });
    await agent.patch(`/api/v1/master-data/${privateRecord.id}`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ fullName: "Cross tenant attempt" }).expect(404);

    await prisma.user.update({ where: { id: tenantB.userId }, data: { role: "VIEWER" } });
    await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ type: "EMPLOYEE", identifier: "B-ROLE", fullName: "Role Changed" }).expect(403);

    await prisma.user.update({ where: { id: tenantB.userId }, data: { active: false } });
    await agent.get("/api/v1/me").expect(401);
  });
});
type ImportCell = string | { formula: string };

async function createImportWorkbook(rows: Array<Record<string, ImportCell>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master Data");
  sheet.addRow([...masterDataColumns]);
  for (const row of rows) sheet.addRow(masterDataColumns.map((column) => row[column] ?? ""));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Sprint 03 Master Data, secure spreadsheet import, and membership", () => {
  it("enforces tenant-scoped CRUD, role checks, and active staff membership", async () => {
    const account = await createAccount("master-data-a");
    const otherAccount = await createAccount("master-data-b");
    const viewerAccount = await createAccount("master-data-viewer", "VIEWER");
    const agent = request.agent(app);
    const otherAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrfToken = signedIn.body.csrfToken as string;
    await login(otherAgent, otherAccount);
    const viewerSignedIn = await login(viewerAgent, viewerAccount);

    const create = (input: Record<string, unknown>) => agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send(input);
    const rejected = await create({ type: "STUDENT", identifier: "STU-001", fullName: "Siswa Sintetis", className: "7-A", grade: "7", schoolYear: "2026/2027", tenantId: otherAccount.tenantId }).expect(400);
    expect(rejected.body.error.code).toBe("VALIDATION_ERROR");
    const student = await create({ type: "STUDENT", identifier: "STU-001", fullName: "Siswa Sintetis", className: "7-A", grade: "7", schoolYear: "2026/2027" }).expect(201);
    const teacher = await create({ type: "TEACHER", identifier: "TCH-001", fullName: "Guru Sintetis", department: "Akademik", position: "Guru" }).expect(201);
    await create({ type: "EMPLOYEE", identifier: "EMP-001", fullName: "Pegawai Sintetis", department: "Operasional", position: "Kasir" }).expect(201);
    await create({ type: "STUDENT", identifier: "STU-001", fullName: "Duplikat Sintetis" }).expect(409);
    await prisma.masterDataRecord.createMany({ data: Array.from({ length: 150 }, (_, index) => ({ tenantId: account.tenantId, type: "STUDENT" as const, identifier: `BATCH-STU-${String(index + 1).padStart(3, "0")}`, fullName: `Batch ${index + 1}`, dataSource: "TEST" })) });
    const eligibleIdentityPage = await agent.get("/api/v1/master-data/member-eligible?page=1&pageSize=1").expect(200);
    const eligibleIdentityNextPage = await agent.get("/api/v1/master-data/member-eligible?page=2&pageSize=1").expect(200);
    const eligibleIdentitySearch = await agent.get("/api/v1/master-data/member-eligible?q=Guru&page=1&pageSize=10").expect(200);
    expect(eligibleIdentityPage.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, pageCount: 2 });
    expect(eligibleIdentityNextPage.body.pagination).toMatchObject({ page: 2, pageSize: 1, total: 2, pageCount: 2 });
    expect([...eligibleIdentityPage.body.data, ...eligibleIdentityNextPage.body.data]).toEqual(expect.arrayContaining([expect.objectContaining({ id: teacher.body.id, type: "TEACHER", active: true })]));
    expect(eligibleIdentitySearch.body).toMatchObject({ data: [expect.objectContaining({ id: teacher.body.id })], pagination: { total: 1 } });
    expect(eligibleIdentityPage.body.data.every((identity: { type: string; active: boolean }) => identity.active && (identity.type === "TEACHER" || identity.type === "EMPLOYEE"))).toBe(true);

    const page = await agent.get("/api/v1/master-data?type=STUDENT&q=Siswa&page=1&pageSize=1").expect(200);
    expect(page.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, pageCount: 1 });
    expect(page.body.data[0]).toMatchObject({ id: student.body.id, className: "7-A" });
    await agent.patch(`/api/v1/master-data/${student.body.id}`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ fullName: "Siswa Sintetis Diperbarui", schoolYear: "2027/2028" }).expect(200);
    const simsManaged = await prisma.masterDataRecord.create({ data: { tenantId: account.tenantId, type: "EMPLOYEE", identifier: "SIMS-ACTIVE-001", fullName: "SIMS Status", dataSource: "SIMS" } });
    await agent.patch(`/api/v1/master-data/${simsManaged.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: false }).expect(409);
    expect((await prisma.masterDataRecord.findUniqueOrThrow({ where: { id: simsManaged.id } })).active).toBe(true);
    const otherMe = await otherAgent.get("/api/v1/me").expect(200);
    await otherAgent.patch(`/api/v1/master-data/${student.body.id}`).set("Origin", origin).set("X-Novo-Csrf", otherMe.body.csrfToken as string).send({ fullName: "Tenant lain" }).expect(404);
    await viewerAgent.get("/api/v1/master-data").expect(403);
    await viewerAgent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", viewerSignedIn.body.csrfToken as string).send({ identityId: teacher.body.id, memberNo: "VIEWER-1" }).expect(403);

    await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: student.body.id, memberNo: "COOP-STU" }).expect(400);
    const member = await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: teacher.body.id, memberNo: "COOP-TCH-001" }).expect(201);
    await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: teacher.body.id, memberNo: "COOP-TCH-002" }).expect(409);
    await agent.patch(`/api/v1/members/${member.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: false }).expect(204);
    await agent.post("/api/v1/funding/accounts").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ memberId: member.body.id }).expect(400);
    await agent.patch(`/api/v1/members/${member.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: true }).expect(204);
    await otherAgent.patch(`/api/v1/members/${member.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", otherMe.body.csrfToken as string).send({ active: false }).expect(404);
    await agent.patch(`/api/v1/master-data/${teacher.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: false }).expect(204);
    await agent.patch(`/api/v1/members/${member.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: true }).expect(400);
    await agent.post("/api/v1/funding/accounts").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ memberId: member.body.id }).expect(400);
    const audits = await agent.get("/api/v1/audit-logs").expect(200);
    expect(audits.body.data.some((entry: { entityType: string }) => entry.entityType === "CooperativeMember")).toBe(true);
  });

  it("rolls back membership creation and status changes when audit recording fails", async () => {
    const account = await createAccount("membership-audit");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrfToken = signedIn.body.csrfToken as string;
    const teacher = await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ type: "TEACHER", identifier: "AUDIT-TCH-001", fullName: "Guru Audit", department: "Akademik", position: "Guru" }).expect(201);

    await withFailingCooperativeMemberAudit("create", async () => {
      await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: teacher.body.id, memberNo: "AUDIT-MEMBER-001" }).expect(500);
    });
    expect(await prisma.cooperativeMember.count({ where: { tenantId: account.tenantId } })).toBe(0);

    const member = await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: teacher.body.id, memberNo: "AUDIT-MEMBER-001" }).expect(201);
    await withFailingCooperativeMemberAudit("deactivate", async () => {
      await agent.patch(`/api/v1/members/${member.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: false }).expect(500);
    });
    expect((await prisma.cooperativeMember.findUniqueOrThrow({ where: { id: member.body.id } })).active).toBe(true);
  });

  it("downloads a template, previews without writes, commits exactly once, and rejects unsafe workbooks", async () => {
    const account = await createAccount("master-import");
    const sameTenantUser = await createTenantUser(account, "master-import-other-user");
    const otherAccount = await createAccount("master-import-other-tenant");
    const agent = request.agent(app);
    const sameTenantAgent = request.agent(app);
    const otherAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const sameTenantSignedIn = await login(sameTenantAgent, sameTenantUser);
    const otherSignedIn = await login(otherAgent, otherAccount);
    const csrfToken = signedIn.body.csrfToken as string;
    const template = await agent.get("/api/v1/master-data/imports/template").buffer(true).parse(binaryResponseParser).expect(200);
    expect(template.headers["content-disposition"]).toContain("novo-master-data-template.xlsx");
    expect(template.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(Buffer.isBuffer(template.body)).toBe(true);
    expect(template.body.byteLength).toBeGreaterThan(100);
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(toExcelJsBuffer(template.body));
    expect(templateWorkbook.getWorksheet("Master Data")?.getRow(1).values).toContain("identifier");
    await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", template.body, { filename: "template.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(400);

    const buffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: "IMP-001", fullName: "Pegawai Import Sintetis", department: "Operasional", position: "Staf Koperasi" }]);
    const preview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", buffer, { filename: "master-data.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    expect(preview.body.summary).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    expect(await prisma.masterDataRecord.count({ where: { tenantId: account.tenantId } })).toBe(0);
    await sameTenantAgent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", sameTenantSignedIn.body.csrfToken as string).send({ previewId: preview.body.previewId, fingerprint: preview.body.fingerprint }).expect(409);
    await otherAgent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", otherSignedIn.body.csrfToken as string).send({ previewId: preview.body.previewId, fingerprint: preview.body.fingerprint }).expect(409);
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: preview.body.previewId, fingerprint: preview.body.fingerprint }).expect(200);
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: preview.body.previewId, fingerprint: preview.body.fingerprint }).expect(409);
    const updateBuffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: "IMP-001", fullName: "Pegawai Import Diperbarui", department: "Operasional", position: "Staf Koperasi" }]);
    const updatePreview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", updateBuffer, { filename: "update.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    expect(updatePreview.body.summary).toEqual({ create: 0, update: 1, skip: 0, error: 0 });
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: updatePreview.body.previewId, fingerprint: updatePreview.body.fingerprint }).expect(200);
    expect((await prisma.masterDataRecord.findFirstOrThrow({ where: { tenantId: account.tenantId, type: "EMPLOYEE", identifier: "IMP-001" } })).fullName).toBe("Pegawai Import Diperbarui");
    expect(await prisma.masterDataRecord.count({ where: { tenantId: account.tenantId } })).toBe(1);

    const audit = await prisma.auditLog.findFirst({ where: { tenantId: account.tenantId, action: "commit_import" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(audit?.after)).not.toContain("Pegawai Import Sintetis");
    await prisma.masterDataRecord.create({ data: { tenantId: account.tenantId, type: "EMPLOYEE", identifier: "SIMS-001", fullName: "SIMS Synthetic", dataSource: "SIMS" } });
    const simsBuffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: "SIMS-001", fullName: "Attempted Manual Rewrite", department: "Operasional", position: "Staf" }]);
    const simsPreview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", simsBuffer, { filename: "sims.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    expect(simsPreview.body.summary).toMatchObject({ skip: 1, error: 0 });
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: simsPreview.body.previewId, fingerprint: "0".repeat(64) }).expect(409);
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: simsPreview.body.previewId, fingerprint: simsPreview.body.fingerprint }).expect(200);
    expect((await prisma.masterDataRecord.findFirstOrThrow({ where: { tenantId: account.tenantId, type: "EMPLOYEE", identifier: "SIMS-001" } })).fullName).toBe("SIMS Synthetic");

    const expiredBuffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: "EXP-001", fullName: "Preview Kedaluwarsa", department: "Operasional", position: "Staf" }]);
    const expiredPreview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", expiredBuffer, { filename: "expired.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    await prisma.masterDataImportPreview.update({ where: { id: expiredPreview.body.previewId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: expiredPreview.body.previewId, fingerprint: expiredPreview.body.fingerprint }).expect(409);

    const concurrentBuffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: "CONCURRENT-001", fullName: "Preview Serentak", department: "Operasional", position: "Staf" }]);
    const concurrentPreview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", concurrentBuffer, { filename: "concurrent.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    const concurrentCommits = await Promise.all([
      agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: concurrentPreview.body.previewId, fingerprint: concurrentPreview.body.fingerprint }),
      agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: concurrentPreview.body.previewId, fingerprint: concurrentPreview.body.fingerprint }),
    ]);
    expect(concurrentCommits.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.masterDataRecord.count({ where: { tenantId: account.tenantId, type: "EMPLOYEE", identifier: "CONCURRENT-001" } })).toBe(1);

    const formulaBuffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: { formula: "1+1" }, fullName: "Formula Sintetis", department: "Operasional", position: "Staf" }]);
    await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", formulaBuffer, { filename: "formula.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(400);
    await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", Buffer.from("not a workbook"), { filename: "bad.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(400);
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: simsPreview.body.previewId, fingerprint: "0".repeat(64) }).expect(409);
  });
});

describe("Sprint 04 Store response security", () => {
  it("enforces Store RBAC, tenant isolation, CSRF, category ownership, and HPP redaction", async () => {
    const owner = await createAccount("store-security-owner");
    const other = await createAccount("store-security-other");
    const cashier = await createTenantUser(owner, "store-security-cashier");
    await prisma.user.update({ where: { id: cashier.userId }, data: { role: "CASHIER" } });
    const ownerAgent = request.agent(app);
    const otherAgent = request.agent(app);
    const cashierAgent = request.agent(app);
    const ownerLogin = await login(ownerAgent, owner);
    const otherLogin = await login(otherAgent, other);
    const cashierLogin = await login(cashierAgent, cashier);
    const ownerCsrf = ownerLogin.body.csrfToken as string;
    const otherCsrf = otherLogin.body.csrfToken as string;
    const cashierCsrf = cashierLogin.body.csrfToken as string;

    await ownerAgent.post("/api/v1/product-categories").set("Origin", origin).send({ name: "No CSRF" }).expect(403);
    const category = await ownerAgent.post("/api/v1/product-categories").set("Origin", origin).set("X-Novo-Csrf", ownerCsrf).send({ name: "Synthetic Category" }).expect(201);
    const foreignCategory = await otherAgent.post("/api/v1/product-categories").set("Origin", origin).set("X-Novo-Csrf", otherCsrf).send({ name: "Other Category" }).expect(201);
    await cashierAgent.post("/api/v1/product-categories").set("Origin", origin).set("X-Novo-Csrf", cashierCsrf).send({ name: "Cashier Cannot Create" }).expect(403);
    await otherAgent.patch("/api/v1/product-categories/" + category.body.id).set("Origin", origin).set("X-Novo-Csrf", otherCsrf).send({ active: false }).expect(404);

    await ownerAgent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", ownerCsrf).send({ sku: "HPP-SEC-01", name: "Synthetic HPP Product", categoryId: foreignCategory.body.id, unitPrice: 10000, unitCost: 4000, initialStock: 2 }).expect(400);
    const product = await ownerAgent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", ownerCsrf).send({ sku: "HPP-SEC-01", name: "Synthetic HPP Product", categoryId: category.body.id, unitPrice: 10000, unitCost: 4000, initialStock: 2 }).expect(201);
    await ownerAgent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", ownerCsrf).send({ sku: "hpp-sec-01", name: "Duplicate", unitPrice: 1 }).expect(409);
    await otherAgent.patch("/api/v1/products/" + product.body.id).set("Origin", origin).set("X-Novo-Csrf", otherCsrf).send({ active: false }).expect(404);

    const checkout = await cashierAgent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", cashierCsrf).set("Idempotency-Key", "store-security-checkout-01").send({ paymentMethod: "CASH", cashReceived: 10000, items: [{ productId: product.body.id, quantity: 1 }] }).expect(201);
    expect(checkout.body).not.toHaveProperty("totalCost");
    expect(checkout.body).not.toHaveProperty("grossMargin");
    expect(checkout.body.items[0]).not.toHaveProperty("unitCost");
    expect(checkout.body.items[0]).not.toHaveProperty("costSubtotal");
    expect(checkout.body.items[0]).not.toHaveProperty("grossMargin");
    await otherAgent.get("/api/v1/sales/" + checkout.body.id).expect(404);
    await otherAgent.get("/api/v1/sales/" + checkout.body.id + "/receipt").expect(404);

    const cashierHistory = await cashierAgent.get("/api/v1/sales").expect(200);
    expect(cashierHistory.body.data[0]).not.toHaveProperty("totalCost");
    expect(cashierHistory.body.data[0].items[0]).not.toHaveProperty("unitCost");
    const receipt = await cashierAgent.get("/api/v1/sales/" + checkout.body.id + "/receipt").expect(200);
    expect(JSON.stringify(receipt.body)).not.toContain("unitCost");
    expect(JSON.stringify(receipt.body)).not.toContain("grossMargin");

    await prisma.user.update({ where: { id: cashier.userId }, data: { role: "FINANCE_OFFICER" } });
    const finance = await cashierAgent.get("/api/v1/sales/" + checkout.body.id).expect(200);
    expect(finance.body.totalCost).toBe(4000);
    expect(finance.body.grossMargin).toBe(6000);
    expect(finance.body.items[0].unitCost).toBe(4000);
    const financeReceipt = await cashierAgent.get("/api/v1/sales/" + checkout.body.id + "/receipt").expect(200);
    expect(JSON.stringify(financeReceipt.body)).not.toContain("unitCost");
    expect(JSON.stringify(financeReceipt.body)).not.toContain("grossMargin");
  });
});


describe("Sprint 04 Product and inventory integrity", () => {
  it("keeps tenant SKU uniqueness, lifecycle, stock balances, and movement history consistent", async () => {
    const account = await createAccount("inventory-integrity"); const other = await createAccount("inventory-integrity-other");
    const agent = request.agent(app); const otherAgent = request.agent(app);
    const loginResult = await login(agent, account); const csrf = loginResult.body.csrfToken as string;
    const otherLogin = await login(otherAgent, other); const otherCsrf = otherLogin.body.csrfToken as string;
    const category = await agent.post("/api/v1/product-categories").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ name: "Inventory" }).expect(201);
    const product = await agent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ sku: "INV-001", name: "Synthetic Inventory", categoryId: category.body.id, unitPrice: 10000, unitCost: 5000, reorderLevel: 3, initialStock: 5 }).expect(201);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(5);
    await agent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ sku: "inv-001", name: "Duplicate", unitPrice: 1 }).expect(409);
    await otherAgent.patch("/api/v1/products/" + product.body.id).set("Origin", origin).set("X-Novo-Csrf", otherCsrf).send({ active: false }).expect(404);
    await agent.post("/api/v1/products/" + product.body.id + "/receipts").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ quantity: 4, reference: "RCV-TEST" }).expect(201);
    await agent.post("/api/v1/products/" + product.body.id + "/adjustments").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ quantity: -2, reason: "Synthetic count" }).expect(201);
    await agent.post("/api/v1/products/" + product.body.id + "/adjustments").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ quantity: -99, reason: "Rejected negative" }).expect(409);
    const persisted = await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } }); expect(persisted.stockOnHand).toBe(7);
    const movements = await agent.get("/api/v1/products/" + product.body.id + "/movements?page=1&pageSize=10").expect(200);
    expect(movements.body.pagination.total).toBe(3); expect(movements.body.data.map((item: { quantity: number }) => item.quantity).sort()).toEqual([-2,4,5]);
    expect(movements.body.data.every((item: { balanceAfter: number; performedBy: { name: string } }) => typeof item.balanceAfter === "number" && item.performedBy.name.length > 0)).toBe(true);
    const lowStock = await agent.get("/api/v1/products?lowStock=true").expect(200); expect(lowStock.body.data.some((item: { id: string }) => item.id === product.body.id)).toBe(false);
    await agent.patch("/api/v1/products/" + product.body.id).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ active: false, unitPrice: 12000, unitCost: 6000 }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).active).toBe(false);
  });
});


describe("Sprint 04 Store financial transaction integrity", () => {
  it("prevents overselling, preserves financial snapshots, scopes idempotency, and reverses a sale exactly once", async () => {
    const account = await createAccount("store-transaction"); const agent = request.agent(app);
    const signedIn = await login(agent, account); const csrf = signedIn.body.csrfToken as string;
    const category = await agent.post("/api/v1/product-categories").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ name: "Transactions" }).expect(201);
    const product = await agent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ sku: "TX-001", name: "Transaction Product", categoryId: category.body.id, unitPrice: 10000, unitCost: 4000, initialStock: 2 }).expect(201);
    const item = [{ productId: product.body.id, quantity: 2 }];
    await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "transaction-cash-invalid").send({ paymentMethod: "CASH", cashReceived: 1, items: item, unitPrice: 1, total: 1, tenantId: "forged" }).expect(400);
    await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "transaction-transfer-invalid").send({ paymentMethod: "TRANSFER", items: item }).expect(400);
    const first = agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "transaction-concurrent-a").send({ paymentMethod: "CASH", cashReceived: 20000, items: item });
    const second = agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "transaction-concurrent-b").send({ paymentMethod: "CASH", cashReceived: 20000, items: item });
    const attempts = await Promise.all([first, second]);
    expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
    const accepted = attempts.find((result) => result.status === 201); const acceptedKey = attempts[0]?.status === 201 ? "transaction-concurrent-a" : "transaction-concurrent-b"; if (!accepted) throw new Error("Expected one checkout to succeed.");
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: accepted.body.id }, include: { items: true, payment: true } });
    expect(sale.total.toString()).toBe("20000"); expect(sale.totalCost?.toString()).toBe("8000"); expect(sale.grossMargin?.toString()).toBe("12000");
    expect(sale.items[0]?.productSku).toBe("TX-001"); expect(sale.items[0]?.unitCost?.toString()).toBe("4000"); expect(sale.payment?.cashReceived?.toString()).toBe("20000"); expect(sale.payment?.changeGiven?.toString()).toBe("0");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(0);
    expect(await prisma.sale.count({ where: { tenantId: account.tenantId } })).toBe(1);
    const replay = await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", acceptedKey).send({ paymentMethod: "CASH", cashReceived: 20000, items: item }).expect(200);
    expect(replay.body.idempotentReplay).toBe(true);
    await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", acceptedKey).send({ paymentMethod: "CASH", cashReceived: 10000, items: [{ productId: product.body.id, quantity: 1 }] }).expect(409);
    await prisma.product.update({ where: { id: product.body.id }, data: { unitPrice: 99000, unitCost: 9900 } });
    const snapshot = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } }); expect(snapshot.unitPrice.toString()).toBe("10000"); expect(snapshot.unitCost?.toString()).toBe("4000");
    const voidOne = agent.post("/api/v1/sales/" + sale.id + "/void").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ reason: "Synthetic reversal" });
    const voidTwo = agent.post("/api/v1/sales/" + sale.id + "/void").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ reason: "Synthetic reversal" });
    const voids = await Promise.all([voidOne, voidTwo]); expect(voids.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(2);
    expect(await prisma.stockMovement.count({ where: { saleId: sale.id, reason: "POS_VOID" } })).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe("VOIDED");
  });
});


async function withStoreAuditFailure(action: string, callback: () => Promise<void>): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS novo_fail_store_audit_trigger ON "AuditLog";');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS novo_fail_store_audit();');
  try {
    await prisma.$executeRawUnsafe("CREATE FUNCTION novo_fail_store_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"entityType\" = ''Sale'' AND NEW.action = ''" + action + "'' THEN RAISE EXCEPTION ''forced store audit failure''; END IF; RETURN NEW; END;'");
    await prisma.$executeRawUnsafe('CREATE TRIGGER novo_fail_store_audit_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION novo_fail_store_audit();');
    await callback();
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS novo_fail_store_audit_trigger ON "AuditLog";');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS novo_fail_store_audit();');
  }
}

describe("Sprint 04 Store atomic audit rollback", () => {
  it("rolls back checkout and void when their Sale audit write fails", async () => {
    const account = await createAccount("store-rollback"); const agent = request.agent(app); const loginResult = await login(agent, account); const csrf = loginResult.body.csrfToken as string;
    const product = await agent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ sku: "ROLLBACK-01", name: "Rollback Product", unitPrice: 10000, initialStock: 2 }).expect(201);
    const checkoutBody = { paymentMethod: "CASH", cashReceived: 10000, items: [{ productId: product.body.id, quantity: 1 }] };
    await withStoreAuditFailure("checkout", async () => { await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "rollback-checkout-01").send(checkoutBody).expect(500); });
    expect(await prisma.sale.count({ where: { tenantId: account.tenantId } })).toBe(0); expect(await prisma.storePayment.count({ where: { tenantId: account.tenantId } })).toBe(0); expect(await prisma.stockMovement.count({ where: { tenantId: account.tenantId, reason: "POS_SALE" } })).toBe(0); expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(2);
    const sale = await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "rollback-checkout-02").send(checkoutBody).expect(201);
    await withStoreAuditFailure("void", async () => { await agent.post("/api/v1/sales/" + sale.body.id + "/void").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ reason: "Rollback void" }).expect(500); });
    const persisted = await prisma.sale.findUniqueOrThrow({ where: { id: sale.body.id } }); expect(persisted.status).toBe("COMPLETED"); expect(persisted.voidReason).toBeNull(); expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(1); expect(await prisma.stockMovement.count({ where: { saleId: sale.body.id, reason: "POS_VOID" } })).toBe(0);
  });
});


describe("Sprint 04 StorePayment rollback isolation", () => {
  it("rolls back checkout when StorePayment insertion fails", async () => {
    const account = await createAccount("store-payment-failure"); const agent = request.agent(app); const signedIn = await login(agent, account); const csrf = signedIn.body.csrfToken as string;
    const product = await agent.post("/api/v1/products").set("Origin", origin).set("X-Novo-Csrf", csrf).send({ sku: "PAYFAIL-01", name: "Payment Failure Product", unitPrice: 10000, initialStock: 1 }).expect(201);
    const before = { sales: await prisma.sale.count({ where: { tenantId: account.tenantId } }), items: await prisma.saleItem.count(), payments: await prisma.storePayment.count({ where: { tenantId: account.tenantId } }), movements: await prisma.stockMovement.count({ where: { tenantId: account.tenantId, reason: "POS_SALE" } }), audits: await prisma.auditLog.count({ where: { tenantId: account.tenantId, action: "checkout" } }), stock: (await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand };
    const functionName = "novo_fail_store_payment_fixture"; const triggerName = "novo_fail_store_payment_fixture_trigger";
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS ' + triggerName + ' ON "StorePayment";'); await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ' + functionName + '();');
    try {
      await prisma.$executeRawUnsafe("CREATE FUNCTION " + functionName + "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" + account.tenantId.replace(/'/g, "''") + "'' THEN RAISE EXCEPTION ''forced fixture StorePayment failure''; END IF; RETURN NEW; END;'");
      await prisma.$executeRawUnsafe('CREATE TRIGGER ' + triggerName + ' BEFORE INSERT ON "StorePayment" FOR EACH ROW EXECUTE FUNCTION ' + functionName + '();');
      await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "store-payment-failure-01").send({ paymentMethod: "CASH", cashReceived: 10000, items: [{ productId: product.body.id, quantity: 1 }] }).expect(500);
      expect(await prisma.sale.count({ where: { tenantId: account.tenantId } })).toBe(before.sales); expect(await prisma.saleItem.count()).toBe(before.items); expect(await prisma.storePayment.count({ where: { tenantId: account.tenantId } })).toBe(before.payments); expect(await prisma.stockMovement.count({ where: { tenantId: account.tenantId, reason: "POS_SALE" } })).toBe(before.movements); expect(await prisma.auditLog.count({ where: { tenantId: account.tenantId, action: "checkout" } })).toBe(before.audits); expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(before.stock);
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS ' + triggerName + ' ON "StorePayment";'); await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ' + functionName + '();'); }
    await agent.post("/api/v1/sales").set("Origin", origin).set("X-Novo-Csrf", csrf).set("Idempotency-Key", "store-payment-success-01").send({ paymentMethod: "CASH", cashReceived: 10000, items: [{ productId: product.body.id, quantity: 1 }] }).expect(201);
    expect(await prisma.sale.count({ where: { tenantId: account.tenantId } })).toBe(1); expect(await prisma.storePayment.count({ where: { tenantId: account.tenantId } })).toBe(1); expect(await prisma.stockMovement.count({ where: { tenantId: account.tenantId, reason: "POS_SALE" } })).toBe(1); expect((await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).stockOnHand).toBe(0);
  });
});


async function withFixtureMovementFailure(tenantId: string, reason: string, suffix: string, callback: () => Promise<void>): Promise<void> {
  const fn = "novo_fail_movement_" + suffix; const trigger = fn + "_trigger"; const escaped = tenantId.replace(/'/g, "''");
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS ' + trigger + ' ON "StockMovement";'); await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ' + fn + '();');
  try { await prisma.$executeRawUnsafe("CREATE FUNCTION " + fn + "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" + escaped + "'' AND NEW.reason = ''" + reason + "'' THEN RAISE EXCEPTION ''forced movement failure''; END IF; RETURN NEW; END;'"); await prisma.$executeRawUnsafe('CREATE TRIGGER ' + trigger + ' BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION ' + fn + '();'); await callback(); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS ' + trigger + ' ON "StockMovement";'); await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ' + fn + '();'); }
}

describe("Sprint 04 POS movement rollback", () => {
  it("rolls back checkout when POS_SALE movement insertion fails", async () => {
    const account=await createAccount("pos-sale-failure"); const agent=request.agent(app); const signed=await login(agent,account); const csrf=signed.body.csrfToken as string;
    const product=await agent.post("/api/v1/products").set("Origin",origin).set("X-Novo-Csrf",csrf).send({sku:"SALEFAIL-01",name:"Sale Failure",unitPrice:10000,initialStock:1}).expect(201);
    await withFixtureMovementFailure(account.tenantId,"POS_SALE","sale",async()=>{await agent.post("/api/v1/sales").set("Origin",origin).set("X-Novo-Csrf",csrf).set("Idempotency-Key","pos-sale-fail-01").send({paymentMethod:"CASH",cashReceived:10000,items:[{productId:product.body.id,quantity:1}]}).expect(500);});
    expect(await prisma.sale.count({where:{tenantId:account.tenantId}})).toBe(0);expect(await prisma.storePayment.count({where:{tenantId:account.tenantId}})).toBe(0);expect(await prisma.stockMovement.count({where:{tenantId:account.tenantId,reason:"POS_SALE"}})).toBe(0);expect((await prisma.product.findUniqueOrThrow({where:{id:product.body.id}})).stockOnHand).toBe(1);
    await agent.post("/api/v1/sales").set("Origin",origin).set("X-Novo-Csrf",csrf).set("Idempotency-Key","pos-sale-success-01").send({paymentMethod:"CASH",cashReceived:10000,items:[{productId:product.body.id,quantity:1}]}).expect(201);expect(await prisma.sale.count({where:{tenantId:account.tenantId}})).toBe(1);
  });
  it("rolls back void when POS_VOID movement insertion fails", async () => {
    const account=await createAccount("pos-void-failure"); const agent=request.agent(app); const signed=await login(agent,account); const csrf=signed.body.csrfToken as string;
    const product=await agent.post("/api/v1/products").set("Origin",origin).set("X-Novo-Csrf",csrf).send({sku:"VOIDFAIL-01",name:"Void Failure",unitPrice:10000,initialStock:1}).expect(201);
    const sale=await agent.post("/api/v1/sales").set("Origin",origin).set("X-Novo-Csrf",csrf).set("Idempotency-Key","pos-void-sale-01").send({paymentMethod:"CASH",cashReceived:10000,items:[{productId:product.body.id,quantity:1}]}).expect(201);
    await withFixtureMovementFailure(account.tenantId,"POS_VOID","void",async()=>{await agent.post("/api/v1/sales/"+sale.body.id+"/void").set("Origin",origin).set("X-Novo-Csrf",csrf).send({reason:"Injected movement failure"}).expect(500);});
    const unchanged=await prisma.sale.findUniqueOrThrow({where:{id:sale.body.id}});expect(unchanged.status).toBe("COMPLETED");expect(unchanged.voidReason).toBeNull();expect(unchanged.voidedAt).toBeNull();expect((await prisma.product.findUniqueOrThrow({where:{id:product.body.id}})).stockOnHand).toBe(0);expect(await prisma.stockMovement.count({where:{saleId:sale.body.id,reason:"POS_VOID"}})).toBe(0);expect(await prisma.auditLog.count({where:{entityId:sale.body.id,action:"void"}})).toBe(0);
    await agent.post("/api/v1/sales/"+sale.body.id+"/void").set("Origin",origin).set("X-Novo-Csrf",csrf).send({reason:"Retry after cleanup"}).expect(200);expect((await prisma.sale.findUniqueOrThrow({where:{id:sale.body.id}})).status).toBe("VOIDED");expect(await prisma.stockMovement.count({where:{saleId:sale.body.id,reason:"POS_VOID"}})).toBe(1);expect((await prisma.product.findUniqueOrThrow({where:{id:product.body.id}})).stockOnHand).toBe(1);
  });
});


describe("Sprint 04 receipt movement rollback", () => {
  it("rolls back stock receipt when STOCK_RECEIPT movement insertion fails", async () => {
    const account=await createAccount("receipt-movement-failure");const agent=request.agent(app);const signed=await login(agent,account);const csrf=signed.body.csrfToken as string;
    const product=await agent.post("/api/v1/products").set("Origin",origin).set("X-Novo-Csrf",csrf).send({sku:"RCVFAIL-01",name:"Receipt Failure",unitPrice:10000,initialStock:2}).expect(201);
    const baseline={stock:(await prisma.product.findUniqueOrThrow({where:{id:product.body.id}})).stockOnHand,movements:await prisma.stockMovement.count({where:{productId:product.body.id}}),audits:await prisma.auditLog.count({where:{tenantId:account.tenantId,action:"receive_stock",entityId:product.body.id}})};
    await withFixtureMovementFailure(account.tenantId,"STOCK_RECEIPT","receipt",async()=>{await agent.post("/api/v1/products/"+product.body.id+"/receipts").set("Origin",origin).set("X-Novo-Csrf",csrf).send({quantity:3,reference:"RCV-FAIL-01"}).expect(500);});
    expect((await prisma.product.findUniqueOrThrow({where:{id:product.body.id}})).stockOnHand).toBe(baseline.stock);expect(await prisma.stockMovement.count({where:{productId:product.body.id}})).toBe(baseline.movements);expect(await prisma.auditLog.count({where:{tenantId:account.tenantId,action:"receive_stock",entityId:product.body.id}})).toBe(baseline.audits);
    await agent.post("/api/v1/products/"+product.body.id+"/receipts").set("Origin",origin).set("X-Novo-Csrf",csrf).send({quantity:3,reference:"RCV-OK-01"}).expect(201);expect((await prisma.product.findUniqueOrThrow({where:{id:product.body.id}})).stockOnHand).toBe(5);expect(await prisma.stockMovement.count({where:{productId:product.body.id,reason:"STOCK_RECEIPT"}})).toBe(1);
  });
});


describe("Sprint 04 receipt audit rollback",()=>{it("rolls back stock receipt when receive_stock audit insertion fails",async()=>{const a=await createAccount("receipt-audit-failure");const g=request.agent(app),l=await login(g,a),c=l.body.csrfToken as string;const p=await g.post("/api/v1/products").set("Origin",origin).set("X-Novo-Csrf",c).send({sku:"RCVAUD-01",name:"Receipt Audit",unitPrice:10000,initialStock:2}).expect(201);const base={stock:(await prisma.product.findUniqueOrThrow({where:{id:p.body.id}})).stockOnHand,m:await prisma.stockMovement.count({where:{productId:p.body.id}}),a:await prisma.auditLog.count({where:{tenantId:a.tenantId,action:"receive_stock"}})};const fn="novo_fail_receipt_audit",tr=fn+"_trigger";await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS '+tr+' ON "AuditLog";');try{await prisma.$executeRawUnsafe("CREATE FUNCTION "+fn+"() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''"+a.tenantId.replace(/'/g,"''")+"'' AND NEW.action = ''receive_stock'' THEN RAISE EXCEPTION ''receipt audit failure''; END IF; RETURN NEW; END;'");await prisma.$executeRawUnsafe('CREATE TRIGGER '+tr+' BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION '+fn+'();');await g.post("/api/v1/products/"+p.body.id+"/receipts").set("Origin",origin).set("X-Novo-Csrf",c).send({quantity:3,reference:"AUD-FAIL"}).expect(500);expect((await prisma.product.findUniqueOrThrow({where:{id:p.body.id}})).stockOnHand).toBe(base.stock);expect(await prisma.stockMovement.count({where:{productId:p.body.id}})).toBe(base.m);expect(await prisma.auditLog.count({where:{tenantId:a.tenantId,action:"receive_stock"}})).toBe(base.a);}finally{await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS '+tr+' ON "AuditLog";');await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS '+fn+'();');}await g.post("/api/v1/products/"+p.body.id+"/receipts").set("Origin",origin).set("X-Novo-Csrf",c).send({quantity:3,reference:"AUD-OK"}).expect(201);expect((await prisma.product.findUniqueOrThrow({where:{id:p.body.id}})).stockOnHand).toBe(5);});});

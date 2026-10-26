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
import { masterDataColumns } from "./master-data-import.js";

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

async function clearTestData(): Promise<void> {
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

    const page = await agent.get("/api/v1/master-data?type=STUDENT&q=Siswa&page=1&pageSize=1").expect(200);
    expect(page.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1, pageCount: 1 });
    expect(page.body.data[0]).toMatchObject({ id: student.body.id, className: "7-A" });
    await agent.patch(`/api/v1/master-data/${student.body.id}`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ fullName: "Siswa Sintetis Diperbarui", schoolYear: "2027/2028" }).expect(200);
    const otherMe = await otherAgent.get("/api/v1/me").expect(200);
    await otherAgent.patch(`/api/v1/master-data/${student.body.id}`).set("Origin", origin).set("X-Novo-Csrf", otherMe.body.csrfToken as string).send({ fullName: "Tenant lain" }).expect(404);
    await viewerAgent.get("/api/v1/master-data").expect(403);
    await viewerAgent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", viewerSignedIn.body.csrfToken as string).send({ identityId: teacher.body.id, memberNo: "VIEWER-1" }).expect(403);

    await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: student.body.id, memberNo: "COOP-STU" }).expect(400);
    const member = await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: teacher.body.id, memberNo: "COOP-TCH-001" }).expect(201);
    await agent.post("/api/v1/members").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ identityId: teacher.body.id, memberNo: "COOP-TCH-002" }).expect(409);
    await agent.patch(`/api/v1/master-data/${teacher.body.id}/active`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ active: false }).expect(204);
    await agent.post("/api/v1/funding/accounts").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ memberId: member.body.id }).expect(400);
    const audits = await agent.get("/api/v1/audit-logs").expect(200);
    expect(audits.body.data.some((entry: { entityType: string }) => entry.entityType === "CooperativeMember")).toBe(true);
  });

  it("downloads a template, previews without writes, commits exactly once, and rejects unsafe workbooks", async () => {
    const account = await createAccount("master-import");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrfToken = signedIn.body.csrfToken as string;
    const template = await agent.get("/api/v1/master-data/imports/template").expect(200);
    expect(template.headers["content-disposition"]).toContain("novo-master-data-template.xlsx");
    expect(template.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(template.body as Buffer);
    expect(templateWorkbook.getWorksheet("Master Data")?.getRow(1).values).toContain("identifier");

    const buffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: "IMP-001", fullName: "Pegawai Import Sintetis", department: "Operasional", position: "Staf Koperasi" }]);
    const preview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", buffer, { filename: "master-data.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    expect(preview.body.summary).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    expect(await prisma.masterDataRecord.count({ where: { tenantId: account.tenantId } })).toBe(0);
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

    const formulaBuffer = await createImportWorkbook([{ type: "EMPLOYEE", identifier: { formula: "1+1" }, fullName: "Formula Sintetis", department: "Operasional", position: "Staf" }]);
    const formulaPreview = await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", formulaBuffer, { filename: "formula.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(201);
    expect(formulaPreview.body.summary.error).toBeGreaterThan(0);
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: formulaPreview.body.previewId, fingerprint: formulaPreview.body.fingerprint }).expect(422);
    await agent.post("/api/v1/master-data/imports/preview").set("Origin", origin).set("X-Novo-Csrf", csrfToken).attach("file", Buffer.from("not a workbook"), { filename: "bad.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).expect(400);
    await agent.post("/api/v1/master-data/imports/commit").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ previewId: simsPreview.body.previewId, fingerprint: "0".repeat(64) }).expect(409);
  });
});
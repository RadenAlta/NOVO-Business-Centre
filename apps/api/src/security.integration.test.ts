import bcrypt from "bcryptjs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "./app.js";
import { hashSecret } from "./auth.js";
import { prisma } from "./db.js";
import { env } from "./env.js";

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

async function login(agent: request.SuperAgentTest, account: TestAccount): Promise<request.Response> {
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

    await agent.get("/api/v1/master-data").expect({ data: [] });
    await agent.patch(`/api/v1/master-data/${privateRecord.id}`).set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ fullName: "Cross tenant attempt" }).expect(404);

    await prisma.user.update({ where: { id: tenantB.userId }, data: { role: "VIEWER" } });
    await agent.post("/api/v1/master-data").set("Origin", origin).set("X-Novo-Csrf", csrfToken).send({ type: "EMPLOYEE", identifier: "B-ROLE", fullName: "Role Changed" }).expect(403);

    await prisma.user.update({ where: { id: tenantB.userId }, data: { active: false } });
    await agent.get("/api/v1/me").expect(401);
  });
});
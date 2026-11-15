import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "./app.js";
import { hashSecret } from "./auth.js";
import { prisma } from "./db.js";
import { purgeExpiredImportPreviews } from "./import-preview-retention.js";
import { env } from "./env.js";
import { masterDataColumns, toExcelJsBuffer } from "./master-data-import.js";
import type { UserRole } from "./roles.js";

const origin = "http://localhost:5173";
const testDatabase = process.env.DATABASE_URL ?? "";

if (
  process.env.NODE_ENV !== "test" ||
  !/\/novo_(?:ci|test)(?:\?|$)/.test(testDatabase)
) {
  throw new Error(
    "Security integration tests require NODE_ENV=test and a disposable DATABASE_URL named novo_ci or novo_test.",
  );
}

type TestAccount = {
  tenantId: string;
  slug: string;
  userId: string;
  email: string;
  password: string;
};

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const first = Array.isArray(header) ? header[0] : header;
  if (!first) throw new Error("Expected session cookie.");
  return first.split(";", 1)[0] ?? "";
}

function binaryResponseParser(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
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
  await prisma.settlementPayment.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.shuttleSettlementPayment.deleteMany();
  await prisma.shuttleSettlement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.shuttleBillingPeriod.deleteMany();
  await prisma.shuttleFinancialConfig.deleteMany();
  await prisma.shuttleSubscription.deleteMany();
  await prisma.shuttleRoute.deleteMany();
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

async function createAccount(
  slug: string,
  role: UserRole = "ADMIN",
): Promise<TestAccount> {
  const tenant = await prisma.tenant.create({
    data: { name: `Tenant ${slug}`, slug },
  });
  const email = `${slug}@example.test`;
  const password = "SecurityPass123!";
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      name: `User ${slug}`,
      passwordHash: await bcrypt.hash(password, 4),
      role,
    },
  });
  return { tenantId: tenant.id, slug, userId: user.id, email, password };
}

async function login(
  agent: ReturnType<typeof request.agent>,
  account: TestAccount,
): Promise<request.Response> {
  return agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({
      tenantSlug: account.slug,
      email: account.email,
      password: account.password,
    })
    .expect(200);
}

async function createTenantUser(
  account: TestAccount,
  emailPrefix: string,
  role: UserRole = "ADMIN",
): Promise<TestAccount> {
  const email = `${emailPrefix}@example.test`;
  const password = "SecurityPass123!";
  const user = await prisma.user.create({
    data: {
      tenantId: account.tenantId,
      email,
      name: `User ${emailPrefix}`,
      passwordHash: await bcrypt.hash(password, 4),
      role,
    },
  });
  return {
    tenantId: account.tenantId,
    slug: account.slug,
    userId: user.id,
    email,
    password,
  };
}

async function createEligibleShuttleMember(
  account: TestAccount,
  suffix: string,
) {
  const identity = await prisma.masterDataRecord.create({
    data: {
      tenantId: account.tenantId,
      type: "TEACHER",
      identifier: `TEACHER-${suffix}`,
      fullName: `Eligible Teacher ${suffix}`,
    },
  });
  return prisma.cooperativeMember.create({
    data: {
      tenantId: account.tenantId,
      identityId: identity.id,
      memberNo: `MEMBER-${suffix}`,
      name: identity.fullName,
    },
  });
}

async function createFinalizedShuttlePaymentFixture(
  account: TestAccount,
  suffix: string,
) {
  const finalizedAt = new Date("2026-11-03T00:00:00.000Z");
  const member = await createEligibleShuttleMember(account, `RACE-${suffix}`);
  const route = await prisma.shuttleRoute.create({
    data: { tenantId: account.tenantId, code: `RACE-${suffix}`, name: `Race Route ${suffix}`, stops: ["Synthetic Start", "Synthetic School"], monthlyRate: 100_000 },
  });
  const subscription = await prisma.shuttleSubscription.create({
    data: { tenantId: account.tenantId, memberId: member.id, routeId: route.id, startDate: new Date("2026-11-01T00:00:00.000Z"), effectiveMonthlyRate: 100_000 },
  });
  const period = await prisma.shuttleBillingPeriod.create({
    data: {
      tenantId: account.tenantId,
      startsAt: new Date("2026-11-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-01T00:00:00.000Z"),
      status: "FINALIZED",
      finalizedAt,
      finalizedById: account.userId,
    },
  });
  await prisma.shuttleFinancialConfig.create({
    data: {
      tenantId: account.tenantId,
      vendorName: "Synthetic Shuttle Vendor",
      vendorShareBps: 6_000,
      cooperativeShareBps: 4_000,
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      tenantId: account.tenantId,
      subscriptionId: subscription.id,
      shuttleBillingPeriodId: period.id,
      invoiceNo: `INV-RACE-${suffix}`,
      description: "Synthetic finalised Shuttle invoice",
      amount: 100_000,
      routeCodeSnapshot: route.code,
      routeNameSnapshot: route.name,
      rateSnapshot: 100_000,
      proratedDays: 30,
      periodDays: 30,
      status: "PAID",
      issuedAt: finalizedAt,
      finalizedAt,
      finalizedById: account.userId,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      tenantId: account.tenantId,
      invoiceId: invoice.id,
      reference: `PAY-RACE-${suffix}`,
      amount: 100_000,
      method: "TRANSFER",
      status: "VERIFIED",
      verifiedAt: finalizedAt,
      verifiedById: account.userId,
    },
  });
  return { period, invoice, payment };
}

async function createCollectibleShuttleInvoiceFixture(
  account: TestAccount,
  suffix: string,
  amount = 100_000,
) {
  const finalizedAt = new Date("2026-11-03T00:00:00.000Z");
  const member = await createEligibleShuttleMember(account, `COLLECT-${suffix}`);
  const route = await prisma.shuttleRoute.create({
    data: { tenantId: account.tenantId, code: `COLLECT-${suffix}`, name: `Collectible Route ${suffix}`, stops: ["Synthetic Start", "Synthetic School"], monthlyRate: amount },
  });
  const subscription = await prisma.shuttleSubscription.create({
    data: { tenantId: account.tenantId, memberId: member.id, routeId: route.id, startDate: new Date("2026-11-01T00:00:00.000Z"), effectiveMonthlyRate: amount },
  });
  const period = await prisma.shuttleBillingPeriod.create({
    data: { tenantId: account.tenantId, startsAt: new Date("2026-10-31T17:00:00.000Z"), endsAt: new Date("2026-11-30T17:00:00.000Z"), status: "FINALIZED", finalizedAt, finalizedById: account.userId },
  });
  const invoice = await prisma.invoice.create({
    data: { tenantId: account.tenantId, subscriptionId: subscription.id, shuttleBillingPeriodId: period.id, invoiceNo: `INV-COLLECT-${suffix}`, description: "Synthetic collectible Shuttle invoice", amount, status: "ISSUED", issuedAt: finalizedAt, finalizedAt, finalizedById: account.userId, routeCodeSnapshot: route.code, routeNameSnapshot: route.name, rateSnapshot: amount, proratedDays: 30, periodDays: 30 },
  });
  return { period, invoice, subscription };
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function expectPostgresCheckConstraint(
  operation: () => Promise<unknown>,
  constraint: string,
): Promise<void> {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(
    failure instanceof Prisma.PrismaClientUnknownRequestError ||
      (failure instanceof Prisma.PrismaClientKnownRequestError &&
        failure.code === "P2010"),
  ).toBe(true);
  const message = (failure as Error).message;
  expect(message).toContain(constraint);
  expect(message).toContain("23514");
}

async function withFailingShuttleAudit(
  tenantId: string,
  entityType: string,
  action: string,
  callback: () => Promise<void>,
): Promise<void> {
  const functionName = "novo_fail_shuttle_audit";
  const triggerName = "novo_fail_shuttle_audit_trigger";
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${triggerName} ON "AuditLog";`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}();`);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW."tenantId" = ''${sqlLiteral(tenantId)}'' AND NEW."entityType" = ''${sqlLiteral(entityType)}'' AND NEW."action" = ''${sqlLiteral(action)}'' THEN RAISE EXCEPTION ''forced Shuttle audit failure''; END IF; RETURN NEW; END;'`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${functionName}();`,
    );
    await callback();
  } finally {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${triggerName} ON "AuditLog";`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS ${functionName}();`,
    );
  }
}

const cooperativeMemberAuditFailureSql = {
  create: `CREATE OR REPLACE FUNCTION novo_fail_cooperative_member_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW."entityType" = ''CooperativeMember'' AND NEW.action = ''create'' THEN RAISE EXCEPTION ''forced cooperative-member audit failure''; END IF; RETURN NEW; END;'`,
  deactivate: `CREATE OR REPLACE FUNCTION novo_fail_cooperative_member_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW."entityType" = ''CooperativeMember'' AND NEW.action = ''deactivate'' THEN RAISE EXCEPTION ''forced cooperative-member audit failure''; END IF; RETURN NEW; END;'`,
} as const;

async function withFailingCooperativeMemberAudit(
  action: keyof typeof cooperativeMemberAuditFailureSql,
  callback: () => Promise<void>,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS novo_fail_cooperative_member_audit_trigger ON "AuditLog";',
  );
  await prisma.$executeRawUnsafe(
    "DROP FUNCTION IF EXISTS novo_fail_cooperative_member_audit();",
  );
  try {
    await prisma.$executeRawUnsafe(cooperativeMemberAuditFailureSql[action]);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER novo_fail_cooperative_member_audit_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION novo_fail_cooperative_member_audit();',
    );
    await callback();
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS novo_fail_cooperative_member_audit_trigger ON "AuditLog";',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS novo_fail_cooperative_member_audit();",
    );
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

describe("F4 activity-classification suggestion proxy", () => {
  const validProviderResult = () => new Response(JSON.stringify({
    predicted_category: "INVENTORY",
    confidence: 0.91,
    decision_score: null,
    model_version: "activity-category-v0.2-synthetic",
    label_version: "activity-category-v0.1",
    inference_status: "ok",
  }), { status: 200, headers: { "content-type": "application/json" } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("secures a suggestion-only classification without persisting input or mutating business records", async () => {
    const account = await createAccount("f4-suggestion", "ANALYST");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const oldCookie = cookieFrom(signedIn);
    const csrfToken = signedIn.body.csrfToken as string;
    const fetchMock = vi.fn().mockResolvedValue(validProviderResult());
    vi.stubGlobal("fetch", fetchMock);

    const before = await Promise.all([
      prisma.invoice.count({ where: { tenantId: account.tenantId } }),
      prisma.shuttleSettlement.count({ where: { tenantId: account.tenantId } }),
      prisma.stockMovement.count({ where: { tenantId: account.tenantId } }),
    ]);
    const response = await agent
      .post("/api/v1/analytics/activity-classification")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ noteDeidentified: "Stok minuman perlu dihitung ulang sebelum toko dibuka." })
      .expect(200);

    expect(response.body).toEqual({
      predictedCategory: "INVENTORY",
      confidence: 0.91,
      modelVersion: "activity-category-v0.2-synthetic",
      labelVersion: "activity-category-v0.1",
      inferenceStatus: "SUCCESS",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${env.ML_SERVICE_URL}/v1/activity-category/predict`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ note_deidentified: "Stok minuman perlu dihitung ulang sebelum toko dibuka." }),
      }),
    );
    await expect(Promise.all([
      prisma.invoice.count({ where: { tenantId: account.tenantId } }),
      prisma.shuttleSettlement.count({ where: { tenantId: account.tenantId } }),
      prisma.stockMovement.count({ where: { tenantId: account.tenantId } }),
    ])).resolves.toEqual(before);
    const auditRecord = await prisma.auditLog.findFirst({ where: { tenantId: account.tenantId, action: "suggest_activity_category" } });
    expect(auditRecord?.after).toMatchObject({ predictedCategory: "INVENTORY", inferenceStatus: "SUCCESS" });
    expect(JSON.stringify(auditRecord?.after)).not.toContain("Stok minuman");

    await agent.post("/api/v1/auth/logout").set("Origin", origin).set("X-Novo-Csrf", csrfToken).expect(204);
    await request(app)
      .post("/api/v1/analytics/activity-classification")
      .set("Cookie", oldCookie)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ noteDeidentified: "Sesi lama tidak boleh meminta saran." })
      .expect(401);
  });

  it("requires a valid session, role, CSRF token, and server-derived tenant scope", async () => {
    const analyst = await createAccount("f4-analyst", "ANALYST");
    const viewer = await createAccount("f4-viewer", "VIEWER");
    const analystAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    const analystSignIn = await login(analystAgent, analyst);
    const viewerSignIn = await login(viewerAgent, viewer);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(validProviderResult()));

    await request(app).post("/api/v1/analytics/activity-classification").send({ noteDeidentified: "Catatan operasional yang valid." }).expect(401);
    await viewerAgent
      .post("/api/v1/analytics/activity-classification")
      .set("Origin", origin)
      .set("X-Novo-Csrf", viewerSignIn.body.csrfToken as string)
      .send({ noteDeidentified: "Catatan operasional yang valid." })
      .expect(403);
    await analystAgent
      .post("/api/v1/analytics/activity-classification")
      .set("Origin", origin)
      .send({ noteDeidentified: "Catatan operasional yang valid." })
      .expect(403);
    await analystAgent
      .post("/api/v1/analytics/activity-classification")
      .set("Origin", origin)
      .set("X-Novo-Csrf", analystSignIn.body.csrfToken as string)
      .send({ noteDeidentified: "Catatan operasional yang valid.", tenantId: viewer.tenantId })
      .expect(400);
    await analystAgent
      .post("/api/v1/analytics/activity-classification")
      .set("Origin", origin)
      .set("X-Novo-Csrf", analystSignIn.body.csrfToken as string)
      .send({ noteDeidentified: "  " })
      .expect(400);
  });

  it("fails closed for unavailable, timed-out, and malformed model-provider responses", async () => {
    const account = await createAccount("f4-provider", "ANALYST");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const requestClassification = () => agent
      .post("/api/v1/analytics/activity-classification")
      .set("Origin", origin)
      .set("X-Novo-Csrf", signedIn.body.csrfToken as string)
      .send({ noteDeidentified: "Catatan operasional untuk uji kegagalan model." });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await requestClassification().expect(503);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    await requestClassification().expect(504);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ predicted_category: "UNKNOWN" }), { status: 200 })));
    await requestClassification().expect(502);
    await expect(prisma.auditLog.count({ where: { tenantId: account.tenantId, action: "suggest_activity_category" } })).resolves.toBe(0);
  });
});

describe("revocable browser sessions", () => {
  it("bootstraps with an HttpOnly opaque cookie and never returns a bearer token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/bootstrap")
      .set("Origin", origin)
      .send({
        tenantName: "Bootstrap Tenant",
        slug: "bootstrap-tenant",
        ownerName: "Bootstrap Owner",
        email: "owner@bootstrap.test",
        password: "BootstrapPass123!",
      })
      .expect(201);

    expect(response.body).toMatchObject({
      user: { email: "owner@bootstrap.test" },
      tenant: { slug: "bootstrap-tenant" },
    });
    expect(response.body).not.toHaveProperty("token");
    expect(response.body.csrfToken).toEqual(expect.any(String));
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");

    const rawCookie = cookieFrom(response).replace("novo_session=", "");
    const session = await prisma.userSession.findUnique({
      where: { tokenHash: hashSecret(rawCookie) },
    });
    expect(session?.tokenHash).not.toBe(rawCookie);
    expect(session?.csrfTokenHash).not.toBe(response.body.csrfToken);

    await request(app)
      .post("/api/v1/auth/bootstrap")
      .set("Origin", origin)
      .send({
        tenantName: "Second Tenant",
        slug: "second-tenant",
        ownerName: "Second Owner",
        email: "owner@second.test",
        password: "SecondOwnerPass123!",
      })
      .expect(409);
  });

  it("reloads through /me, revokes logout server-side, and rejects a replayed cookie", async () => {
    const account = await createAccount("session-tenant");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const oldCookie = cookieFrom(signedIn);

    const me = await agent.get("/api/v1/me").expect(200);
    expect(me.body).toMatchObject({
      user: { id: account.userId, tenantId: account.tenantId },
      tenant: { slug: account.slug },
    });
    expect(me.body.csrfToken).toEqual(expect.any(String));

    await agent
      .post("/api/v1/auth/logout")
      .set("Origin", origin)
      .set("X-Novo-Csrf", me.body.csrfToken)
      .expect(204);
    await request(app).get("/api/v1/me").set("Cookie", oldCookie).expect(401);
    await agent.post("/api/v1/auth/logout").set("Origin", origin).expect(204);
  });

  it("keeps concurrent /me CSRF responses usable for subsequent writes", async () => {
    const account = await createAccount("csrf-concurrency");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const rawToken = cookieFrom(signedIn).replace("novo_session=", "");

    // Simulate a session issued before the stable-CSRF migration, then overlap two session restores.
    await prisma.userSession.update({
      where: { tokenHash: hashSecret(rawToken) },
      data: { csrfToken: null },
    });
    const [first, second] = await Promise.all([
      agent.get("/api/v1/me").expect(200),
      agent.get("/api/v1/me").expect(200),
    ]);
    expect(first.body.csrfToken).toEqual(second.body.csrfToken);

    await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .set("X-Novo-Csrf", first.body.csrfToken)
      .send({
        type: "EMPLOYEE",
        identifier: "CSRF-RACE-1",
        fullName: "Concurrent Session One",
      })
      .expect(201);
    await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .set("X-Novo-Csrf", second.body.csrfToken)
      .send({
        type: "EMPLOYEE",
        identifier: "CSRF-RACE-2",
        fullName: "Concurrent Session Two",
      })
      .expect(201);
  });
  it("rejects bearer-only, altered, and expired browser session credentials", async () => {
    const account = await createAccount("tamper-tenant");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const cookie = cookieFrom(signedIn);
    const rawToken = cookie.replace("novo_session=", "");

    await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${rawToken}`)
      .expect(401);
    await request(app)
      .get("/api/v1/me")
      .set("Cookie", "novo_session=altered-value")
      .expect(401);
    await prisma.userSession.update({
      where: { tokenHash: hashSecret(rawToken) },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app).get("/api/v1/me").set("Cookie", cookie).expect(401);
  });
});

describe("CSRF, current RBAC, and tenant isolation", () => {
  it("requires a session-bound CSRF token and trusted origin for writes, including multipart upload", async () => {
    const account = await createAccount("csrf-tenant");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrfToken = signedIn.body.csrfToken as string;

    await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .send({
        type: "EMPLOYEE",
        identifier: "EMP-001",
        fullName: "Synthetic Employee",
      })
      .expect(403);
    await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .set("X-Novo-Csrf", "wrong-token")
      .send({
        type: "EMPLOYEE",
        identifier: "EMP-001",
        fullName: "Synthetic Employee",
      })
      .expect(403);
    await agent
      .post("/api/v1/master-data")
      .set("Origin", "https://attacker.example")
      .set("X-Novo-Csrf", csrfToken)
      .send({
        type: "EMPLOYEE",
        identifier: "EMP-001",
        fullName: "Synthetic Employee",
      })
      .expect(403);
    await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        type: "EMPLOYEE",
        identifier: "EMP-001",
        fullName: "Synthetic Employee",
      })
      .expect(201);
    await agent.get("/api/v1/master-data").expect(200);

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    await agent
      .post("/api/v1/attachments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .field("entityType", "MasterDataRecord")
      .field("entityId", "synthetic-employee")
      .attach("file", png, {
        filename: "receipt.png",
        contentType: "image/png",
      })
      .expect(201);
  });

  it("uses the database role and tenant on every request", async () => {
    const tenantA = await createAccount("tenant-a");
    const tenantB = await createAccount("tenant-b");
    const privateRecord = await prisma.masterDataRecord.create({
      data: {
        tenantId: tenantA.tenantId,
        type: "EMPLOYEE",
        identifier: "A-PRIVATE",
        fullName: "Tenant A Only",
        dataSource: "TEST",
      },
    });
    const agent = request.agent(app);
    const signedIn = await login(agent, tenantB);
    const csrfToken = signedIn.body.csrfToken as string;

    const emptyPage = await agent.get("/api/v1/master-data").expect(200);
    expect(emptyPage.body).toMatchObject({
      data: [],
      pagination: { page: 1, pageSize: 50, total: 0, pageCount: 0 },
    });
    await agent
      .patch(`/api/v1/master-data/${privateRecord.id}`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ fullName: "Cross tenant attempt" })
      .expect(404);

    await prisma.user.update({
      where: { id: tenantB.userId },
      data: { role: "VIEWER" },
    });
    await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        type: "EMPLOYEE",
        identifier: "B-ROLE",
        fullName: "Role Changed",
      })
      .expect(403);

    await prisma.user.update({
      where: { id: tenantB.userId },
      data: { active: false },
    });
    await agent.get("/api/v1/me").expect(401);
  });
});
type ImportCell = string | { formula: string };

async function createImportWorkbook(
  rows: Array<Record<string, ImportCell>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Master Data");
  sheet.addRow([...masterDataColumns]);
  for (const row of rows)
    sheet.addRow(masterDataColumns.map((column) => row[column] ?? ""));
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

    const create = (input: Record<string, unknown>) =>
      agent
        .post("/api/v1/master-data")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrfToken)
        .send(input);
    const rejected = await create({
      type: "STUDENT",
      identifier: "STU-001",
      fullName: "Siswa Sintetis",
      className: "7-A",
      grade: "7",
      schoolYear: "2026/2027",
      tenantId: otherAccount.tenantId,
    }).expect(400);
    expect(rejected.body.error.code).toBe("VALIDATION_ERROR");
    const student = await create({
      type: "STUDENT",
      identifier: "STU-001",
      fullName: "Siswa Sintetis",
      className: "7-A",
      grade: "7",
      schoolYear: "2026/2027",
    }).expect(201);
    const teacher = await create({
      type: "TEACHER",
      identifier: "TCH-001",
      fullName: "Guru Sintetis",
      department: "Akademik",
      position: "Guru",
    }).expect(201);
    await create({
      type: "EMPLOYEE",
      identifier: "EMP-001",
      fullName: "Pegawai Sintetis",
      department: "Operasional",
      position: "Kasir",
    }).expect(201);
    await create({
      type: "STUDENT",
      identifier: "STU-001",
      fullName: "Duplikat Sintetis",
    }).expect(409);
    await prisma.masterDataRecord.createMany({
      data: Array.from({ length: 150 }, (_, index) => ({
        tenantId: account.tenantId,
        type: "STUDENT" as const,
        identifier: `BATCH-STU-${String(index + 1).padStart(3, "0")}`,
        fullName: `Batch ${index + 1}`,
        dataSource: "TEST",
      })),
    });
    const eligibleIdentityPage = await agent
      .get("/api/v1/master-data/member-eligible?page=1&pageSize=1")
      .expect(200);
    const eligibleIdentityNextPage = await agent
      .get("/api/v1/master-data/member-eligible?page=2&pageSize=1")
      .expect(200);
    const eligibleIdentitySearch = await agent
      .get("/api/v1/master-data/member-eligible?q=Guru&page=1&pageSize=10")
      .expect(200);
    expect(eligibleIdentityPage.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      pageCount: 2,
    });
    expect(eligibleIdentityNextPage.body.pagination).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      pageCount: 2,
    });
    expect([
      ...eligibleIdentityPage.body.data,
      ...eligibleIdentityNextPage.body.data,
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: teacher.body.id,
          type: "TEACHER",
          active: true,
        }),
      ]),
    );
    expect(eligibleIdentitySearch.body).toMatchObject({
      data: [expect.objectContaining({ id: teacher.body.id })],
      pagination: { total: 1 },
    });
    expect(
      eligibleIdentityPage.body.data.every(
        (identity: { type: string; active: boolean }) =>
          identity.active &&
          (identity.type === "TEACHER" || identity.type === "EMPLOYEE"),
      ),
    ).toBe(true);

    const page = await agent
      .get("/api/v1/master-data?type=STUDENT&q=Siswa&page=1&pageSize=1")
      .expect(200);
    expect(page.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      pageCount: 1,
    });
    expect(page.body.data[0]).toMatchObject({
      id: student.body.id,
      className: "7-A",
    });
    await agent
      .patch(`/api/v1/master-data/${student.body.id}`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ fullName: "Siswa Sintetis Diperbarui", schoolYear: "2027/2028" })
      .expect(200);
    const simsManaged = await prisma.masterDataRecord.create({
      data: {
        tenantId: account.tenantId,
        type: "EMPLOYEE",
        identifier: "SIMS-ACTIVE-001",
        fullName: "SIMS Status",
        dataSource: "SIMS",
      },
    });
    await agent
      .patch(`/api/v1/master-data/${simsManaged.id}/active`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ active: false })
      .expect(409);
    expect(
      (
        await prisma.masterDataRecord.findUniqueOrThrow({
          where: { id: simsManaged.id },
        })
      ).active,
    ).toBe(true);
    const otherMe = await otherAgent.get("/api/v1/me").expect(200);
    await otherAgent
      .patch(`/api/v1/master-data/${student.body.id}`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherMe.body.csrfToken as string)
      .send({ fullName: "Tenant lain" })
      .expect(404);
    await viewerAgent.get("/api/v1/master-data").expect(403);
    await viewerAgent
      .post("/api/v1/members")
      .set("Origin", origin)
      .set("X-Novo-Csrf", viewerSignedIn.body.csrfToken as string)
      .send({ identityId: teacher.body.id, memberNo: "VIEWER-1" })
      .expect(403);

    await agent
      .post("/api/v1/members")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ identityId: student.body.id, memberNo: "COOP-STU" })
      .expect(400);
    const member = await agent
      .post("/api/v1/members")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ identityId: teacher.body.id, memberNo: "COOP-TCH-001" })
      .expect(201);
    await agent
      .post("/api/v1/members")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ identityId: teacher.body.id, memberNo: "COOP-TCH-002" })
      .expect(409);
    await agent
      .patch(`/api/v1/members/${member.body.id}/active`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ active: false })
      .expect(204);
    await agent
      .post("/api/v1/funding/accounts")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ memberId: member.body.id })
      .expect(400);
    await agent
      .patch(`/api/v1/members/${member.body.id}/active`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ active: true })
      .expect(204);
    await otherAgent
      .patch(`/api/v1/members/${member.body.id}/active`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherMe.body.csrfToken as string)
      .send({ active: false })
      .expect(404);
    await agent
      .patch(`/api/v1/master-data/${teacher.body.id}/active`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ active: false })
      .expect(204);
    await agent
      .patch(`/api/v1/members/${member.body.id}/active`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ active: true })
      .expect(400);
    await agent
      .post("/api/v1/funding/accounts")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ memberId: member.body.id })
      .expect(400);
    const audits = await agent.get("/api/v1/audit-logs").expect(200);
    expect(
      audits.body.data.some(
        (entry: { entityType: string }) =>
          entry.entityType === "CooperativeMember",
      ),
    ).toBe(true);
  });

  it("rolls back membership creation and status changes when audit recording fails", async () => {
    const account = await createAccount("membership-audit");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrfToken = signedIn.body.csrfToken as string;
    const teacher = await agent
      .post("/api/v1/master-data")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        type: "TEACHER",
        identifier: "AUDIT-TCH-001",
        fullName: "Guru Audit",
        department: "Akademik",
        position: "Guru",
      })
      .expect(201);

    await withFailingCooperativeMemberAudit("create", async () => {
      await agent
        .post("/api/v1/members")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrfToken)
        .send({ identityId: teacher.body.id, memberNo: "AUDIT-MEMBER-001" })
        .expect(500);
    });
    expect(
      await prisma.cooperativeMember.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);

    const member = await agent
      .post("/api/v1/members")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({ identityId: teacher.body.id, memberNo: "AUDIT-MEMBER-001" })
      .expect(201);
    await withFailingCooperativeMemberAudit("deactivate", async () => {
      await agent
        .patch(`/api/v1/members/${member.body.id}/active`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrfToken)
        .send({ active: false })
        .expect(500);
    });
    expect(
      (
        await prisma.cooperativeMember.findUniqueOrThrow({
          where: { id: member.body.id },
        })
      ).active,
    ).toBe(true);
  });

  it("downloads a template, previews without writes, commits exactly once, and rejects unsafe workbooks", async () => {
    const account = await createAccount("master-import");
    const sameTenantUser = await createTenantUser(
      account,
      "master-import-other-user",
    );
    const otherAccount = await createAccount("master-import-other-tenant");
    const agent = request.agent(app);
    const sameTenantAgent = request.agent(app);
    const otherAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const sameTenantSignedIn = await login(sameTenantAgent, sameTenantUser);
    const otherSignedIn = await login(otherAgent, otherAccount);
    const csrfToken = signedIn.body.csrfToken as string;
    const template = await agent
      .get("/api/v1/master-data/imports/template")
      .buffer(true)
      .parse(binaryResponseParser)
      .expect(200);
    expect(template.headers["content-disposition"]).toContain(
      "novo-master-data-template.xlsx",
    );
    expect(template.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(Buffer.isBuffer(template.body)).toBe(true);
    expect(template.body.byteLength).toBeGreaterThan(100);
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load(toExcelJsBuffer(template.body));
    expect(
      templateWorkbook.getWorksheet("Master Data")?.getRow(1).values,
    ).toContain("identifier");
    await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", template.body, {
        filename: "template.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(400);

    const buffer = await createImportWorkbook([
      {
        type: "EMPLOYEE",
        identifier: "IMP-001",
        fullName: "Pegawai Import Sintetis",
        department: "Operasional",
        position: "Staf Koperasi",
      },
    ]);
    const preview = await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", buffer, {
        filename: "master-data.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(201);
    expect(preview.body.summary).toEqual({
      create: 1,
      update: 0,
      skip: 0,
      error: 0,
    });
    expect(
      await prisma.masterDataRecord.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);
    await sameTenantAgent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", sameTenantSignedIn.body.csrfToken as string)
      .send({
        previewId: preview.body.previewId,
        fingerprint: preview.body.fingerprint,
      })
      .expect(409);
    await otherAgent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherSignedIn.body.csrfToken as string)
      .send({
        previewId: preview.body.previewId,
        fingerprint: preview.body.fingerprint,
      })
      .expect(409);
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: preview.body.previewId,
        fingerprint: preview.body.fingerprint,
      })
      .expect(200);
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: preview.body.previewId,
        fingerprint: preview.body.fingerprint,
      })
      .expect(409);
    const updateBuffer = await createImportWorkbook([
      {
        type: "EMPLOYEE",
        identifier: "IMP-001",
        fullName: "Pegawai Import Diperbarui",
        department: "Operasional",
        position: "Staf Koperasi",
      },
    ]);
    const updatePreview = await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", updateBuffer, {
        filename: "update.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(201);
    expect(updatePreview.body.summary).toEqual({
      create: 0,
      update: 1,
      skip: 0,
      error: 0,
    });
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: updatePreview.body.previewId,
        fingerprint: updatePreview.body.fingerprint,
      })
      .expect(200);
    expect(
      (
        await prisma.masterDataRecord.findFirstOrThrow({
          where: {
            tenantId: account.tenantId,
            type: "EMPLOYEE",
            identifier: "IMP-001",
          },
        })
      ).fullName,
    ).toBe("Pegawai Import Diperbarui");
    expect(
      await prisma.masterDataRecord.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: account.tenantId, action: "commit_import" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit?.after)).not.toContain(
      "Pegawai Import Sintetis",
    );
    await prisma.masterDataRecord.create({
      data: {
        tenantId: account.tenantId,
        type: "EMPLOYEE",
        identifier: "SIMS-001",
        fullName: "SIMS Synthetic",
        dataSource: "SIMS",
      },
    });
    const simsBuffer = await createImportWorkbook([
      {
        type: "EMPLOYEE",
        identifier: "SIMS-001",
        fullName: "Attempted Manual Rewrite",
        department: "Operasional",
        position: "Staf",
      },
    ]);
    const simsPreview = await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", simsBuffer, {
        filename: "sims.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(201);
    expect(simsPreview.body.summary).toMatchObject({ skip: 1, error: 0 });
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: simsPreview.body.previewId,
        fingerprint: "0".repeat(64),
      })
      .expect(409);
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: simsPreview.body.previewId,
        fingerprint: simsPreview.body.fingerprint,
      })
      .expect(200);
    expect(
      (
        await prisma.masterDataRecord.findFirstOrThrow({
          where: {
            tenantId: account.tenantId,
            type: "EMPLOYEE",
            identifier: "SIMS-001",
          },
        })
      ).fullName,
    ).toBe("SIMS Synthetic");

    const expiredBuffer = await createImportWorkbook([
      {
        type: "EMPLOYEE",
        identifier: "EXP-001",
        fullName: "Preview Kedaluwarsa",
        department: "Operasional",
        position: "Staf",
      },
    ]);
    const expiredPreview = await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", expiredBuffer, {
        filename: "expired.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(201);
    await prisma.masterDataImportPreview.update({
      where: { id: expiredPreview.body.previewId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: expiredPreview.body.previewId,
        fingerprint: expiredPreview.body.fingerprint,
      })
      .expect(409);

    const concurrentBuffer = await createImportWorkbook([
      {
        type: "EMPLOYEE",
        identifier: "CONCURRENT-001",
        fullName: "Preview Serentak",
        department: "Operasional",
        position: "Staf",
      },
    ]);
    const concurrentPreview = await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", concurrentBuffer, {
        filename: "concurrent.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(201);
    const concurrentCommits = await Promise.all([
      agent
        .post("/api/v1/master-data/imports/commit")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrfToken)
        .send({
          previewId: concurrentPreview.body.previewId,
          fingerprint: concurrentPreview.body.fingerprint,
        }),
      agent
        .post("/api/v1/master-data/imports/commit")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrfToken)
        .send({
          previewId: concurrentPreview.body.previewId,
          fingerprint: concurrentPreview.body.fingerprint,
        }),
    ]);
    expect(concurrentCommits.map((response) => response.status).sort()).toEqual(
      [200, 409],
    );
    expect(
      await prisma.masterDataRecord.count({
        where: {
          tenantId: account.tenantId,
          type: "EMPLOYEE",
          identifier: "CONCURRENT-001",
        },
      }),
    ).toBe(1);

    const formulaBuffer = await createImportWorkbook([
      {
        type: "EMPLOYEE",
        identifier: { formula: "1+1" },
        fullName: "Formula Sintetis",
        department: "Operasional",
        position: "Staf",
      },
    ]);
    await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", formulaBuffer, {
        filename: "formula.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(400);
    await agent
      .post("/api/v1/master-data/imports/preview")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .attach("file", Buffer.from("not a workbook"), {
        filename: "bad.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      .expect(400);
    await agent
      .post("/api/v1/master-data/imports/commit")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrfToken)
      .send({
        previewId: simsPreview.body.previewId,
        fingerprint: "0".repeat(64),
      })
      .expect(409);
  });
});

describe("Sprint 04 Store response security", () => {
  it("enforces Store RBAC, tenant isolation, CSRF, category ownership, and HPP redaction", async () => {
    const owner = await createAccount("store-security-owner");
    const other = await createAccount("store-security-other");
    const cashier = await createTenantUser(owner, "store-security-cashier");
    await prisma.user.update({
      where: { id: cashier.userId },
      data: { role: "CASHIER" },
    });
    const ownerAgent = request.agent(app);
    const otherAgent = request.agent(app);
    const cashierAgent = request.agent(app);
    const ownerLogin = await login(ownerAgent, owner);
    const otherLogin = await login(otherAgent, other);
    const cashierLogin = await login(cashierAgent, cashier);
    const ownerCsrf = ownerLogin.body.csrfToken as string;
    const otherCsrf = otherLogin.body.csrfToken as string;
    const cashierCsrf = cashierLogin.body.csrfToken as string;

    await ownerAgent
      .post("/api/v1/product-categories")
      .set("Origin", origin)
      .send({ name: "No CSRF" })
      .expect(403);
    const category = await ownerAgent
      .post("/api/v1/product-categories")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({ name: "Synthetic Category" })
      .expect(201);
    const foreignCategory = await otherAgent
      .post("/api/v1/product-categories")
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherCsrf)
      .send({ name: "Other Category" })
      .expect(201);
    await cashierAgent
      .post("/api/v1/product-categories")
      .set("Origin", origin)
      .set("X-Novo-Csrf", cashierCsrf)
      .send({ name: "Cashier Cannot Create" })
      .expect(403);
    await otherAgent
      .patch("/api/v1/product-categories/" + category.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherCsrf)
      .send({ active: false })
      .expect(404);

    await ownerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({
        sku: "HPP-SEC-01",
        name: "Synthetic HPP Product",
        categoryId: foreignCategory.body.id,
        unitPrice: 10000,
        unitCost: 4000,
        initialStock: 2,
      })
      .expect(400);
    const product = await ownerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({
        sku: "HPP-SEC-01",
        name: "Synthetic HPP Product",
        categoryId: category.body.id,
        unitPrice: 10000,
        unitCost: 4000,
        initialStock: 2,
      })
      .expect(201);
    await ownerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({ sku: "hpp-sec-01", name: "Duplicate", unitPrice: 1 })
      .expect(409);
    await otherAgent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherCsrf)
      .send({ active: false })
      .expect(404);

    const checkout = await cashierAgent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", cashierCsrf)
      .set("Idempotency-Key", "store-security-checkout-01")
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(201);
    expect(checkout.body).not.toHaveProperty("totalCost");
    expect(checkout.body).not.toHaveProperty("grossMargin");
    expect(checkout.body.items[0]).not.toHaveProperty("unitCost");
    expect(checkout.body.items[0]).not.toHaveProperty("costSubtotal");
    expect(checkout.body.items[0]).not.toHaveProperty("grossMargin");
    await otherAgent.get("/api/v1/sales/" + checkout.body.id).expect(404);
    await otherAgent
      .get("/api/v1/sales/" + checkout.body.id + "/receipt")
      .expect(404);

    const cashierHistory = await cashierAgent.get("/api/v1/sales").expect(200);
    expect(cashierHistory.body.data[0]).not.toHaveProperty("totalCost");
    expect(cashierHistory.body.data[0].items[0]).not.toHaveProperty("unitCost");
    const receipt = await cashierAgent
      .get("/api/v1/sales/" + checkout.body.id + "/receipt")
      .expect(200);
    expect(JSON.stringify(receipt.body)).not.toContain("unitCost");
    expect(JSON.stringify(receipt.body)).not.toContain("grossMargin");

    await prisma.user.update({
      where: { id: cashier.userId },
      data: { role: "FINANCE_OFFICER" },
    });
    const finance = await cashierAgent
      .get("/api/v1/sales/" + checkout.body.id)
      .expect(200);
    expect(finance.body.totalCost).toBe(4000);
    expect(finance.body.grossMargin).toBe(6000);
    expect(finance.body.items[0].unitCost).toBe(4000);
    const financeReceipt = await cashierAgent
      .get("/api/v1/sales/" + checkout.body.id + "/receipt")
      .expect(200);
    expect(JSON.stringify(financeReceipt.body)).not.toContain("unitCost");
    expect(JSON.stringify(financeReceipt.body)).not.toContain("grossMargin");
  });
});

describe("MED-01 structured import preview retention", () => {
  it("purges expired previews across tenants and users without deleting active previews", async () => {
    const primary = await createAccount("retention-primary");
    const secondUser = await createTenantUser(primary, "retention-second-user");
    const foreign = await createAccount("retention-foreign");

    const cutoff = new Date("2030-01-01T12:00:00.000Z");
    const expired = new Date(cutoff.getTime() - 1000);
    const active = new Date(cutoff.getTime() + 1000);

    async function makePreview(
      tenantId: string,
      createdById: string,
      expiresAt: Date,
      consumedAt: Date | null = null,
    ) {
      return prisma.masterDataImportPreview.create({
        data: {
          tenantId,
          createdById,
          fingerprint: "a".repeat(64),
          payload: {
            rows: [
              {
                identifier: "SYNTHETIC-001",
                fullName: "Synthetic Retention Fixture",
              },
            ],
            issues: [],
          },
          expiresAt,
          consumedAt,
        },
      });
    }

    const expiredOwner = await makePreview(
      primary.tenantId,
      primary.userId,
      expired,
    );

    const expiredSecondUser = await makePreview(
      primary.tenantId,
      secondUser.userId,
      expired,
      new Date(cutoff.getTime() - 30000),
    );

    const expiredForeign = await makePreview(
      foreign.tenantId,
      foreign.userId,
      expired,
    );

    const expiredAtBoundary = await makePreview(
      foreign.tenantId,
      foreign.userId,
      cutoff,
    );

    const activeOwner = await makePreview(
      primary.tenantId,
      primary.userId,
      active,
    );

    const activeForeign = await makePreview(
      foreign.tenantId,
      foreign.userId,
      active,
    );

    expect(await purgeExpiredImportPreviews(cutoff)).toBe(4);

    for (const preview of [
      expiredOwner,
      expiredSecondUser,
      expiredForeign,
      expiredAtBoundary,
    ]) {
      expect(
        await prisma.masterDataImportPreview.findUnique({
          where: { id: preview.id },
        }),
      ).toBeNull();
    }

    const retained = await prisma.masterDataImportPreview.findMany({
      select: { id: true },
    });

    expect(retained.map((row) => row.id).sort()).toEqual(
      [activeOwner.id, activeForeign.id].sort(),
    );

    const activePayload =
      await prisma.masterDataImportPreview.findUniqueOrThrow({
        where: { id: activeOwner.id },
      });

    expect(activePayload.payload).toMatchObject({
      rows: [{ fullName: "Synthetic Retention Fixture" }],
    });

    expect(await purgeExpiredImportPreviews(cutoff)).toBe(0);

    expect(await prisma.masterDataRecord.count()).toBe(0);
  });
});
describe("Sprint 04 SKU raw-input API contract", () => {
  it("rejects whitespace on product creation without side effects", async () => {
    const account = await createAccount("sku-input-post");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const rejectedSkus = [
      " ABC-001",
      "ABC-001 ",
      " ABC-001 ",
      "\tABC-001",
      "ABC-001\n",
      "\u00A0ABC-001",
      "ABC 001",
    ];

    for (const sku of rejectedSkus) {
      await agent
        .post("/api/v1/products")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({
          sku,
          name: "Rejected SKU Product",
          unitPrice: 10000,
          initialStock: 2,
        })
        .expect(400);
    }

    expect(
      await prisma.product.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);

    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);

    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Product",
        },
      }),
    ).toBe(0);

    const created = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "abc-001",
        name: "Valid SKU Product",
        unitPrice: 10000,
        initialStock: 2,
      })
      .expect(201);

    expect(created.body.sku).toBe("ABC-001");

    const persisted = await prisma.product.findUniqueOrThrow({
      where: { id: created.body.id },
    });

    expect(persisted.sku).toBe("ABC-001");
    expect(persisted.stockOnHand).toBe(2);
  });

  it("rejects whitespace on SKU updates while preserving tenant isolation", async () => {
    const account = await createAccount("sku-input-patch");
    const foreign = await createAccount("sku-input-foreign");

    const agent = request.agent(app);
    const foreignAgent = request.agent(app);

    const signedIn = await login(agent, account);
    const foreignSignedIn = await login(foreignAgent, foreign);

    const csrf = signedIn.body.csrfToken as string;
    const foreignCsrf = foreignSignedIn.body.csrfToken as string;

    const created = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "abc-001",
        name: "Original SKU Product",
        unitPrice: 10000,
      })
      .expect(201);

    const foreignCreated = await foreignAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send({
        sku: "abc-001",
        name: "Foreign SKU Product",
        unitPrice: 10000,
      })
      .expect(201);

    expect(created.body.sku).toBe("ABC-001");
    expect(foreignCreated.body.sku).toBe("ABC-001");

    const auditFilter = {
      tenantId: account.tenantId,
      entityType: "Product",
      entityId: created.body.id,
      action: "update",
    };

    const beforeAudits = await prisma.auditLog.count({
      where: auditFilter,
    });

    for (const sku of [
      " DEF-002",
      "DEF-002 ",
      " DEF-002 ",
      "\tDEF-002",
      "DEF-002\n",
      "DEF 002",
    ]) {
      await agent
        .patch("/api/v1/products/" + created.body.id)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({ sku })
        .expect(400);

      const persisted = await prisma.product.findUniqueOrThrow({
        where: { id: created.body.id },
      });

      expect(persisted.sku).toBe("ABC-001");
    }

    expect(await prisma.auditLog.count({ where: auditFilter })).toBe(
      beforeAudits,
    );

    await foreignAgent
      .patch("/api/v1/products/" + created.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send({ sku: "def-002" })
      .expect(404);

    const updated = await agent
      .patch("/api/v1/products/" + created.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ sku: "def-002" })
      .expect(200);

    expect(updated.body.sku).toBe("DEF-002");

    const [ownProduct, foreignProduct] = await Promise.all([
      prisma.product.findUniqueOrThrow({
        where: { id: created.body.id },
      }),
      prisma.product.findUniqueOrThrow({
        where: { id: foreignCreated.body.id },
      }),
    ]);

    expect(ownProduct.sku).toBe("DEF-002");
    expect(foreignProduct.sku).toBe("ABC-001");
  });
});
describe("Sprint 04 Product and inventory integrity", () => {
  it("keeps tenant SKU uniqueness, lifecycle, stock balances, and movement history consistent", async () => {
    const account = await createAccount("inventory-integrity");
    const other = await createAccount("inventory-integrity-other");
    const agent = request.agent(app);
    const otherAgent = request.agent(app);
    const loginResult = await login(agent, account);
    const csrf = loginResult.body.csrfToken as string;
    const otherLogin = await login(otherAgent, other);
    const otherCsrf = otherLogin.body.csrfToken as string;
    const category = await agent
      .post("/api/v1/product-categories")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ name: "Inventory" })
      .expect(201);
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "INV-001",
        name: "Synthetic Inventory",
        categoryId: category.body.id,
        unitPrice: 10000,
        unitCost: 5000,
        reorderLevel: 3,
        initialStock: 5,
      })
      .expect(201);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(5);
    await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ sku: "inv-001", name: "Duplicate", unitPrice: 1 })
      .expect(409);
    await otherAgent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherCsrf)
      .send({ active: false })
      .expect(404);
    await agent
      .post("/api/v1/products/" + product.body.id + "/receipts")
      .set("Idempotency-Key", "inventory-legacy-001")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ quantity: 4, reference: "RCV-TEST" })
      .expect(201);
    await agent
      .post("/api/v1/products/" + product.body.id + "/adjustments")
      .set("Idempotency-Key", "inventory-legacy-002")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ quantity: -2, reason: "Synthetic count" })
      .expect(201);
    await agent
      .post("/api/v1/products/" + product.body.id + "/adjustments")
      .set("Idempotency-Key", "inventory-legacy-003")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ quantity: -99, reason: "Rejected negative" })
      .expect(409);
    const persisted = await prisma.product.findUniqueOrThrow({
      where: { id: product.body.id },
    });
    expect(persisted.stockOnHand).toBe(7);
    const movements = await agent
      .get(
        "/api/v1/products/" + product.body.id + "/movements?page=1&pageSize=10",
      )
      .expect(200);
    expect(movements.body.pagination.total).toBe(3);
    expect(
      movements.body.data
        .map((item: { quantity: number }) => item.quantity)
        .sort(),
    ).toEqual([-2, 4, 5]);
    expect(
      movements.body.data.every(
        (item: { balanceAfter: number; performedBy: { name: string } }) =>
          typeof item.balanceAfter === "number" &&
          item.performedBy.name.length > 0,
      ),
    ).toBe(true);
    const lowStock = await agent
      .get("/api/v1/products?lowStock=true")
      .expect(200);
    expect(
      lowStock.body.data.some(
        (item: { id: string }) => item.id === product.body.id,
      ),
    ).toBe(false);
    await agent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ active: false, unitPrice: 12000, unitCost: 6000 })
      .expect(200);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).active,
    ).toBe(false);
  });
});

describe("Sprint 04 Store financial transaction integrity", () => {
  it("prevents overselling, preserves financial snapshots, scopes idempotency, and reverses a sale exactly once", async () => {
    const account = await createAccount("store-transaction");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const category = await agent
      .post("/api/v1/product-categories")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ name: "Transactions" })
      .expect(201);
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "TX-001",
        name: "Transaction Product",
        categoryId: category.body.id,
        unitPrice: 10000,
        unitCost: 4000,
        initialStock: 2,
      })
      .expect(201);
    const item = [{ productId: product.body.id, quantity: 2 }];
    await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "transaction-cash-invalid")
      .send({
        paymentMethod: "CASH",
        cashReceived: 1,
        items: item,
        unitPrice: 1,
        total: 1,
        tenantId: "forged",
      })
      .expect(400);
    await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "transaction-transfer-invalid")
      .send({ paymentMethod: "TRANSFER", items: item })
      .expect(400);
    const first = agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "transaction-concurrent-a")
      .send({ paymentMethod: "CASH", cashReceived: 20000, items: item });
    const second = agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "transaction-concurrent-b")
      .send({ paymentMethod: "CASH", cashReceived: 20000, items: item });
    const attempts = await Promise.all([first, second]);
    expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
    const accepted = attempts.find((result) => result.status === 201);
    const acceptedKey =
      attempts[0]?.status === 201
        ? "transaction-concurrent-a"
        : "transaction-concurrent-b";
    if (!accepted) throw new Error("Expected one checkout to succeed.");
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: accepted.body.id },
      include: { items: true, payment: true },
    });
    expect(sale.total.toString()).toBe("20000");
    expect(sale.totalCost?.toString()).toBe("8000");
    expect(sale.grossMargin?.toString()).toBe("12000");
    expect(sale.items[0]?.productSku).toBe("TX-001");
    expect(sale.items[0]?.unitCost?.toString()).toBe("4000");
    expect(sale.payment?.cashReceived?.toString()).toBe("20000");
    expect(sale.payment?.changeGiven?.toString()).toBe("0");
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(0);
    expect(
      await prisma.sale.count({ where: { tenantId: account.tenantId } }),
    ).toBe(1);
    const replay = await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", acceptedKey)
      .send({ paymentMethod: "CASH", cashReceived: 20000, items: item })
      .expect(200);
    expect(replay.body.idempotentReplay).toBe(true);
    await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", acceptedKey)
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(409);
    await prisma.product.update({
      where: { id: product.body.id },
      data: { unitPrice: 99000, unitCost: 9900 },
    });
    const snapshot = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: sale.id },
    });
    expect(snapshot.unitPrice.toString()).toBe("10000");
    expect(snapshot.unitCost?.toString()).toBe("4000");
    const voidOne = agent
      .post("/api/v1/sales/" + sale.id + "/void")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ reason: "Synthetic reversal" });
    const voidTwo = agent
      .post("/api/v1/sales/" + sale.id + "/void")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ reason: "Synthetic reversal" });
    const voids = await Promise.all([voidOne, voidTwo]);
    expect(voids.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(2);
    expect(
      await prisma.stockMovement.count({
        where: { saleId: sale.id, reason: "POS_VOID" },
      }),
    ).toBe(1);
    expect(
      (await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status,
    ).toBe("VOIDED");
  });
});

async function withStoreAuditFailure(
  action: string,
  callback: () => Promise<void>,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS novo_fail_store_audit_trigger ON "AuditLog";',
  );
  await prisma.$executeRawUnsafe(
    "DROP FUNCTION IF EXISTS novo_fail_store_audit();",
  );
  try {
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION novo_fail_store_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"entityType\" = ''Sale'' AND NEW.action = ''" +
        action +
        "'' THEN RAISE EXCEPTION ''forced store audit failure''; END IF; RETURN NEW; END;'",
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER novo_fail_store_audit_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION novo_fail_store_audit();',
    );
    await callback();
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS novo_fail_store_audit_trigger ON "AuditLog";',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS novo_fail_store_audit();",
    );
  }
}

describe("Sprint 04 Store atomic audit rollback", () => {
  it("rolls back checkout and void when their Sale audit write fails", async () => {
    const account = await createAccount("store-rollback");
    const agent = request.agent(app);
    const loginResult = await login(agent, account);
    const csrf = loginResult.body.csrfToken as string;
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "ROLLBACK-01",
        name: "Rollback Product",
        unitPrice: 10000,
        initialStock: 2,
      })
      .expect(201);
    const checkoutBody = {
      paymentMethod: "CASH",
      cashReceived: 10000,
      items: [{ productId: product.body.id, quantity: 1 }],
    };
    await withStoreAuditFailure("checkout", async () => {
      await agent
        .post("/api/v1/sales")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .set("Idempotency-Key", "rollback-checkout-01")
        .send(checkoutBody)
        .expect(500);
    });
    expect(
      await prisma.sale.count({ where: { tenantId: account.tenantId } }),
    ).toBe(0);
    expect(
      await prisma.storePayment.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);
    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, reason: "POS_SALE" },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(2);
    const sale = await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "rollback-checkout-02")
      .send(checkoutBody)
      .expect(201);
    await withStoreAuditFailure("void", async () => {
      await agent
        .post("/api/v1/sales/" + sale.body.id + "/void")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({ reason: "Rollback void" })
        .expect(500);
    });
    const persisted = await prisma.sale.findUniqueOrThrow({
      where: { id: sale.body.id },
    });
    expect(persisted.status).toBe("COMPLETED");
    expect(persisted.voidReason).toBeNull();
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(1);
    expect(
      await prisma.stockMovement.count({
        where: { saleId: sale.body.id, reason: "POS_VOID" },
      }),
    ).toBe(0);
  });
});

describe("Sprint 04 StorePayment rollback isolation", () => {
  it("rolls back checkout when StorePayment insertion fails", async () => {
    const account = await createAccount("store-payment-failure");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "PAYFAIL-01",
        name: "Payment Failure Product",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);
    const before = {
      sales: await prisma.sale.count({ where: { tenantId: account.tenantId } }),
      items: await prisma.saleItem.count(),
      payments: await prisma.storePayment.count({
        where: { tenantId: account.tenantId },
      }),
      movements: await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, reason: "POS_SALE" },
      }),
      audits: await prisma.auditLog.count({
        where: { tenantId: account.tenantId, action: "checkout" },
      }),
      stock: (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    };
    const functionName = "novo_fail_store_payment_fixture";
    const triggerName = "novo_fail_store_payment_fixture_trigger";
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS " + triggerName + ' ON "StorePayment";',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS " + functionName + "();",
    );
    try {
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION " +
          functionName +
          "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" +
          account.tenantId.replace(/'/g, "''") +
          "'' THEN RAISE EXCEPTION ''forced fixture StorePayment failure''; END IF; RETURN NEW; END;'",
      );
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER " +
          triggerName +
          ' BEFORE INSERT ON "StorePayment" FOR EACH ROW EXECUTE FUNCTION ' +
          functionName +
          "();",
      );
      await agent
        .post("/api/v1/sales")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .set("Idempotency-Key", "store-payment-failure-01")
        .send({
          paymentMethod: "CASH",
          cashReceived: 10000,
          items: [{ productId: product.body.id, quantity: 1 }],
        })
        .expect(500);
      expect(
        await prisma.sale.count({ where: { tenantId: account.tenantId } }),
      ).toBe(before.sales);
      expect(await prisma.saleItem.count()).toBe(before.items);
      expect(
        await prisma.storePayment.count({
          where: { tenantId: account.tenantId },
        }),
      ).toBe(before.payments);
      expect(
        await prisma.stockMovement.count({
          where: { tenantId: account.tenantId, reason: "POS_SALE" },
        }),
      ).toBe(before.movements);
      expect(
        await prisma.auditLog.count({
          where: { tenantId: account.tenantId, action: "checkout" },
        }),
      ).toBe(before.audits);
      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: product.body.id },
          })
        ).stockOnHand,
      ).toBe(before.stock);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS " + triggerName + ' ON "StorePayment";',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS " + functionName + "();",
      );
    }
    await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "store-payment-success-01")
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(201);
    expect(
      await prisma.sale.count({ where: { tenantId: account.tenantId } }),
    ).toBe(1);
    expect(
      await prisma.storePayment.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(1);
    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, reason: "POS_SALE" },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(0);
  });
});

describe("Sprint 05 Shuttle foundation", () => {
  it("allows SUPER_ADMIN to read same-tenant invoices through the shared delegated-role policy", async () => {
    const account = await createAccount(
      "shuttle-super-admin-invoices",
      "SUPER_ADMIN",
    );
    const agent = request.agent(app);
    await login(agent, account);
    const { invoice } = await createCollectibleShuttleInvoiceFixture(
      account,
      "SUPER-ADMIN-01",
      100_000,
    );

    const response = await agent.get("/api/v1/billing/invoices").expect(200);
    const visible = response.body.data.find((item: { id: string }) => item.id === invoice.id);
    expect(visible).toMatchObject({ id: invoice.id, invoiceNo: invoice.invoiceNo });
    expect(visible.subscription).toMatchObject({
      member: expect.objectContaining({ name: expect.any(String), memberNo: expect.any(String) }),
    });
    expect(visible.subscription).not.toHaveProperty("payerContact");
    expect(visible.subscription.member).not.toHaveProperty("identityId");
  });

  it("gives Cashier a minimal same-tenant collectible-invoice selection without finance access", async () => {
    const owner = await createAccount("shuttle-cashier-collectible-owner", "OWNER");
    const cashier = await createTenantUser(owner, "shuttle-cashier-collectible", "CASHIER");
    const foreign = await createAccount("shuttle-cashier-collectible-foreign");
    const ownerAgent = request.agent(app);
    const cashierAgent = request.agent(app);
    const foreignAgent = request.agent(app);
    const cashierLogin = await login(cashierAgent, cashier);
    await login(ownerAgent, owner);
    const foreignLogin = await login(foreignAgent, foreign);
    const cashierCsrf = cashierLogin.body.csrfToken as string;
    const foreignCsrf = foreignLogin.body.csrfToken as string;
    const member = await createEligibleShuttleMember(owner, "COLLECTIBLE");
    const route = await prisma.shuttleRoute.create({
      data: { tenantId: owner.tenantId, code: "CASHIER-01", name: "Cashier Route", stops: ["Synthetic Start", "Synthetic School"], monthlyRate: 100 },
    });
    const subscription = await prisma.shuttleSubscription.create({
      data: { tenantId: owner.tenantId, memberId: member.id, routeId: route.id, startDate: new Date("2026-11-01T00:00:00.000Z"), effectiveMonthlyRate: 100 },
    });
    const period = await prisma.shuttleBillingPeriod.create({
      data: {
        tenantId: owner.tenantId,
        startsAt: new Date("2026-10-31T17:00:00.000Z"),
        endsAt: new Date("2026-11-30T17:00:00.000Z"),
        status: "FINALIZED",
        finalizedAt: new Date("2026-11-03T00:00:00.000Z"),
        finalizedById: owner.userId,
      },
    });
    const collectible = await prisma.invoice.create({
      data: {
        tenantId: owner.tenantId,
        subscriptionId: subscription.id,
        shuttleBillingPeriodId: period.id,
        invoiceNo: "INV-COLLECTIBLE-001",
        description: "Synthetic Cashier collectible invoice",
        routeCodeSnapshot: route.code,
        routeNameSnapshot: route.name,
        amount: 100,
        rateSnapshot: 100,
        proratedDays: 30,
        periodDays: 30,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    await prisma.payment.createMany({
      data: [
        { tenantId: owner.tenantId, invoiceId: collectible.id, reference: "PAY-COLLECT-VERIFIED", amount: 30, method: "TRANSFER", status: "VERIFIED" },
        { tenantId: owner.tenantId, invoiceId: collectible.id, reference: "PAY-COLLECT-RECORDED", amount: 20, method: "CASH", status: "RECORDED" },
      ],
    });
    await prisma.invoice.createMany({
      data: [
        { tenantId: owner.tenantId, invoiceNo: "INV-COLLECTIBLE-PAID", description: "Synthetic paid invoice", amount: 100, status: "PAID", issuedAt: new Date() },
        { tenantId: owner.tenantId, invoiceNo: "INV-COLLECTIBLE-VOID", description: "Synthetic void invoice", amount: 100, status: "VOID", issuedAt: new Date() },
      ],
    });
    const foreignInvoice = await prisma.invoice.create({
      data: { tenantId: foreign.tenantId, invoiceNo: "INV-COLLECTIBLE-FOREIGN", description: "Synthetic foreign invoice", amount: 100, status: "ISSUED", issuedAt: new Date() },
    });

    await request(app).get("/api/v1/shuttle/billing/collectible-invoices").expect(401);
    await cashierAgent.get("/api/v1/billing/invoices").expect(403);
    await cashierAgent.get("/api/v1/shuttle/report").expect(403);
    await cashierAgent.post("/api/v1/shuttle/billing-periods/not-a-settlement/settlements").set("Origin", origin).set("X-Novo-Csrf", cashierCsrf).send({}).expect(403);
    await cashierAgent.post(`/api/v1/billing/invoices/${collectible.id}/void`).set("Origin", origin).set("X-Novo-Csrf", cashierCsrf).send({ reason: "Cashier must not void invoices" }).expect(403);
    const existingPayment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: collectible.id, status: "RECORDED" } });
    await cashierAgent.post(`/api/v1/billing/payments/${existingPayment.id}/verify`).set("Origin", origin).set("X-Novo-Csrf", cashierCsrf).send({}).expect(403);
    await cashierAgent.post(`/api/v1/billing/payments/${existingPayment.id}/reverse`).set("Origin", origin).set("X-Novo-Csrf", cashierCsrf).send({ reason: "Cashier must not reverse payments" }).expect(403);

    const selection = await cashierAgent.get("/api/v1/shuttle/billing/collectible-invoices?q=Cashier&page=1&pageSize=1").expect(200);
    expect(selection.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(selection.body.data).toEqual([expect.objectContaining({
      id: collectible.id,
      invoiceNo: "INV-COLLECTIBLE-001",
      routeName: "Cashier Route",
      amount: 100,
      collectibleAmount: 50,
      status: "ISSUED",
    })]);
    expect(selection.body.data[0]).not.toHaveProperty("payments");
    expect(selection.body.data[0]).not.toHaveProperty("vendorAmount");
    expect(selection.body.data[0]).not.toHaveProperty("cooperativeAmount");
    expect(selection.body.data.map((invoice: { id: string }) => invoice.id)).not.toContain(foreignInvoice.id);
    await ownerAgent.get("/api/v1/shuttle/billing/collectible-invoices?q=Cashier").expect(200);

    await cashierAgent
      .post(`/api/v1/billing/invoices/${collectible.id}/payments`)
      .set("Origin", origin)
      .send({ amount: 50, method: "QRIS", reference: "PAY-COLLECT-MISSING-CSRF" })
      .expect(403);
    await cashierAgent
      .post(`/api/v1/billing/invoices/${foreignInvoice.id}/payments`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", cashierCsrf)
      .send({ amount: 1, method: "QRIS", reference: "PAY-COLLECT-FOREIGN" })
      .expect(404);
    await cashierAgent
      .post(`/api/v1/billing/invoices/${collectible.id}/payments`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", cashierCsrf)
      .send({ amount: 50, method: "QRIS", reference: "PAY-COLLECT-REMAINING" })
      .expect(201)
      .expect((response) => expect(response.body.status).toBe("RECORDED"));
    await cashierAgent
      .post(`/api/v1/billing/invoices/${collectible.id}/payments`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", cashierCsrf)
      .send({ amount: 1, method: "QRIS", reference: "PAY-COLLECT-OVERPAY" })
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("OVERPAYMENT"));
    expect(await prisma.payment.count({ where: { tenantId: owner.tenantId, invoiceId: collectible.id } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, entityType: "Payment", action: "record_payment" } })).toBe(1);

    const { invoice: foreignCollectible } = await createCollectibleShuttleInvoiceFixture(
      foreign,
      "FOREIGN-OWNER",
      100,
    );
    await foreignAgent
      .post(`/api/v1/billing/invoices/${foreignCollectible.id}/payments`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send({ amount: 100, method: "TRANSFER", reference: "PAY-COLLECT-FOREIGN-OWNER" })
      .expect(201);
  });

  it("prevents concurrent Cashier recorded payments from reserving more than the invoice", async () => {
    const owner = await createAccount("shuttle-cashier-pending-concurrency", "OWNER");
    const cashier = await createTenantUser(owner, "shuttle-cashier-pending", "CASHIER");
    const agent = request.agent(app);
    const signedIn = await login(agent, cashier);
    const csrf = signedIn.body.csrfToken as string;
    const { invoice } = await createCollectibleShuttleInvoiceFixture(
      owner,
      "CASHIER-CONCURRENT",
      100,
    );
    const attempts = await Promise.all([
      agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 60, method: "CASH", reference: "PAY-CASHIER-CONCURRENT-A" }),
      agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 60, method: "QRIS", reference: "PAY-CASHIER-CONCURRENT-B" }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 409]);
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("RECORDED");
    expect(payments[0]?.amount.toString()).toBe("60");
    expect(await prisma.auditLog.count({ where: { tenantId: owner.tenantId, entityType: "Payment", action: "record_payment" } })).toBe(1);
  });

  it("paginates tenant-scoped routes and enforces route-mutation CSRF and RBAC", async () => {
    const account = await createAccount("shuttle-route-owner");
    const foreign = await createAccount("shuttle-route-foreign");
    const viewer = await createTenantUser(
      account,
      "shuttle-route-viewer",
      "VIEWER",
    );
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const foreignSignedIn = await login(foreignAgent, foreign);
    const viewerSignedIn = await login(viewerAgent, viewer);
    const csrf = signedIn.body.csrfToken as string;
    const foreignCsrf = foreignSignedIn.body.csrfToken as string;
    const viewerCsrf = viewerSignedIn.body.csrfToken as string;
    const routeInput = {
      code: "SH-ALPHA",
      name: "Alpha Shuttle",
      stops: ["Terminal A", "School"],
      monthlyRate: 150000,
    };

    await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .send(routeInput)
      .expect(403);
    await viewerAgent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", viewerCsrf)
      .send(routeInput)
      .expect(403);
    const alpha = await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(routeInput)
      .expect(201);
    await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        code: "SH-BETA",
        name: "Beta Shuttle",
        stops: ["Terminal B", "School"],
        monthlyRate: 175000,
      })
      .expect(201);
    await foreignAgent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send({
        code: "SH-FOREIGN",
        name: "Foreign Shuttle",
        stops: ["Terminal F", "School"],
        monthlyRate: 190000,
      })
      .expect(201);

    const filtered = await agent
      .get("/api/v1/shuttle/routes?q=alpha&page=1&pageSize=1")
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0]).toMatchObject({
      id: alpha.body.id,
      code: "SH-ALPHA",
    });
    expect(filtered.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      pageCount: 1,
    });

    const ownRoutes = await agent
      .get("/api/v1/shuttle/routes?page=1&pageSize=100")
      .expect(200);
    expect(ownRoutes.body.data).toHaveLength(2);
    expect(
      ownRoutes.body.data.some(
        (route: { id: string }) => route.id === alpha.body.id,
      ),
    ).toBe(true);
    expect(
      ownRoutes.body.data.some(
        (route: { code: string }) => route.code === "SH-FOREIGN",
      ),
    ).toBe(false);
  });

  it("validates subscription dates and prevents a foreign route from being assigned", async () => {
    const account = await createAccount("shuttle-subscription-owner");
    const foreign = await createAccount("shuttle-subscription-foreign");
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const foreignSignedIn = await login(foreignAgent, foreign);
    const csrf = signedIn.body.csrfToken as string;
    const foreignCsrf = foreignSignedIn.body.csrfToken as string;
    const member = await createEligibleShuttleMember(account, "SUB-OWNER");
    const route = await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        code: "SH-SUB-OWNER",
        name: "Subscription Owner",
        stops: ["Stop One", "School"],
        monthlyRate: 150000,
      })
      .expect(201);
    const foreignRoute = await foreignAgent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send({
        code: "SH-SUB-FOREIGN",
        name: "Subscription Foreign",
        stops: ["Stop Two", "School"],
        monthlyRate: 160000,
      })
      .expect(201);

    await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        memberId: member.id,
        routeId: route.body.id,
        startDate: "2026-11-02",
        endDate: "2026-11-01",
      })
      .expect(400);
    expect(
      await prisma.shuttleSubscription.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);

    await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        memberId: member.id,
        routeId: foreignRoute.body.id,
        startDate: "2026-11-02",
      })
      .expect(400);
    expect(
      await prisma.shuttleSubscription.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);

    const created = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        memberId: member.id,
        routeId: route.body.id,
        startDate: "2026-11-02",
        endDate: "2026-12-31",
      })
      .expect(201);
    const listed = await agent
      .get(
        "/api/v1/shuttle/subscriptions?q=MEMBER-SUB-OWNER&page=1&pageSize=10",
      )
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({
      id: created.body.id,
      memberId: member.id,
      routeId: route.body.id,
      status: "ACTIVE",
    });
    for (const subscription of [created.body, listed.body.data[0]]) {
      expect(typeof subscription.effectiveMonthlyRate).toBe("number");
      expect(typeof subscription.route.monthlyRate).toBe("number");
      expect(subscription).not.toHaveProperty("tenantId");
      expect(subscription).not.toHaveProperty("payerContact");
      expect(subscription).not.toHaveProperty("invoices");
      expect(subscription.member).toEqual(expect.objectContaining({ id: member.id, memberNo: member.memberNo, name: member.name }));
      expect(subscription.member).not.toHaveProperty("email");
      expect(subscription.member).not.toHaveProperty("phone");
    }
    expect(listed.body.pagination).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it("rolls back route and subscription creation when their audit writes fail", async () => {
    const account = await createAccount("shuttle-audit-rollback");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const routeBody = {
      code: "SH-ROLLBACK",
      name: "Rollback Shuttle",
      stops: ["Start", "School"],
      monthlyRate: 150000,
    };

    await withFailingShuttleAudit(
      account.tenantId,
      "ShuttleRoute",
      "create",
      async () => {
        await agent
          .post("/api/v1/shuttle/routes")
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .send(routeBody)
          .expect(500);
      },
    );
    expect(
      await prisma.shuttleRoute.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "ShuttleRoute",
          action: "create",
        },
      }),
    ).toBe(0);

    const route = await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(routeBody)
      .expect(201);
    const member = await createEligibleShuttleMember(account, "ROLLBACK");
    const subscriptionBody = {
      memberId: member.id,
      routeId: route.body.id,
      startDate: "2026-11-02",
    };
    await withFailingShuttleAudit(
      account.tenantId,
      "ShuttleSubscription",
      "create",
      async () => {
        await agent
          .post("/api/v1/shuttle/subscriptions")
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .send(subscriptionBody)
          .expect(500);
      },
    );
    expect(
      await prisma.shuttleSubscription.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "ShuttleSubscription",
          action: "create",
        },
      }),
    ).toBe(0);

    await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(subscriptionBody)
      .expect(201);
    expect(
      await prisma.shuttleSubscription.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(1);
  });

  it("fails closed on legacy direct invoicing and rolls back Shuttle payment recording when its audit write fails", async () => {
    const account = await createAccount("shuttle-financial-audit-rollback");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const legacy = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        memberId: (await createEligibleShuttleMember(account, "FINANCE")).id,
        routeId: (await prisma.shuttleRoute.create({
          data: {
            tenantId: account.tenantId,
            code: "SH-FINANCE",
            name: "Finance Shuttle",
            stops: ["Finance Stop", "School"],
            monthlyRate: 150000,
          },
        })).id,
        startDate: "2026-11-02",
      })
      .expect(201);
    await agent
      .post(`/api/v1/shuttle/subscriptions/${legacy.body.id}/invoices`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({})
      .expect(409)
      .expect((response) =>
        expect(response.body.error.code).toBe(
          "LEGACY_SHUTTLE_INVOICE_ENDPOINT_RETIRED",
        ),
      );
    expect(await prisma.invoice.count({ where: { tenantId: account.tenantId } })).toBe(0);

    const { invoice } = await createCollectibleShuttleInvoiceFixture(
      account,
      "AUDIT-ROLLBACK",
      150_000,
    );
    await withFailingShuttleAudit(
      account.tenantId,
      "Payment",
      "record_payment",
      async () => {
        await agent
          .post("/api/v1/billing/invoices/" + invoice.body.id + "/payments")
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .send({
            amount: 150000,
            method: "TRANSFER",
            reference: "PAY-ROLLBACK-01",
          })
          .expect(500);
      },
    );
    expect(
      await prisma.payment.count({ where: { tenantId: account.tenantId } }),
    ).toBe(0);
    expect(
      (
        await prisma.invoice.findUniqueOrThrow({
          where: { id: invoice.body.id },
        })
      ).status,
    ).toBe("ISSUED");
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Payment",
          action: "record_payment",
        },
      }),
    ).toBe(0);

    await agent
      .post("/api/v1/billing/invoices/" + invoice.body.id + "/payments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        amount: 150000,
        method: "TRANSFER",
        reference: "PAY-ROLLBACK-02",
      })
      .expect(201);
    expect(
      (
        await prisma.invoice.findUniqueOrThrow({
          where: { id: invoice.body.id },
        })
      ).status,
    ).toBe("PAID");
    expect(
      await prisma.payment.count({ where: { tenantId: account.tenantId } }),
    ).toBe(1);
  });

  it("prevents concurrent Shuttle payments from overpaying an invoice", async () => {
    const account = await createAccount("shuttle-payment-concurrency");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const { invoice } = await createCollectibleShuttleInvoiceFixture(
      account,
      "CONCURRENT-01",
      100,
    );
    const first = agent
      .post("/api/v1/billing/invoices/" + invoice.id + "/payments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ amount: 60, method: "TRANSFER", reference: "PAY-CONCURRENT-01" });
    const second = agent
      .post("/api/v1/billing/invoices/" + invoice.id + "/payments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ amount: 60, method: "QRIS", reference: "PAY-CONCURRENT-02" });
    const attempts = await Promise.all([first, second]);

    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([
      201, 409,
    ]);
    const payments = await prisma.payment.findMany({
      where: { tenantId: account.tenantId, invoiceId: invoice.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.amount.toString()).toBe("60");
    expect(payments[0]?.status).toBe("VERIFIED");
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
        .status,
    ).toBe("ISSUED");
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Payment",
          action: "record_payment",
        },
      }),
    ).toBe(1);
  });

  it("accepts exact whole-Rupiah partial payments and rejects fractional or out-of-range amounts", async () => {
    const account = await createAccount("shuttle-whole-rupiah");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const { invoice } = await createCollectibleShuttleInvoiceFixture(
      account,
      "WHOLE-RUPIAH-01",
      100_000,
    );

    for (const amount of [100000.5, 0, -1, 1_000_000_000]) {
      await agent
        .post("/api/v1/billing/invoices/" + invoice.id + "/payments")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({ amount, method: "TRANSFER", reference: "PAY-INVALID-" + String(amount) })
        .expect(400);
    }
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);

    await agent
      .post("/api/v1/billing/invoices/" + invoice.id + "/payments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ amount: 60000, method: "TRANSFER", reference: "PAY-WHOLE-01" })
      .expect(201);
    await agent
      .post("/api/v1/billing/invoices/" + invoice.id + "/payments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ amount: 40000, method: "QRIS", reference: "PAY-WHOLE-02" })
      .expect(201);
    await agent
      .post("/api/v1/billing/invoices/" + invoice.id + "/payments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ amount: 40000, method: "QRIS", reference: "PAY-WHOLE-02" })
      .expect(200)
      .expect((response) => expect(response.body.idempotentReplay).toBe(true));
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(2);

    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    ).toBe("PAID");
    expect(
      (
        await prisma.payment.aggregate({
          where: { invoiceId: invoice.id, status: "VERIFIED" },
          _sum: { amount: true },
        })
      )._sum.amount?.toString(),
    ).toBe("100000");
  });

  it("keeps generic invoices and payments outside the Shuttle financial state machine", async () => {
    const account = await createAccount("shuttle-generic-domain-boundary");
    const foreign = await createAccount("shuttle-generic-domain-boundary-foreign");
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const [signed, foreignSigned] = await Promise.all([
      login(agent, account),
      login(foreignAgent, foreign),
    ]);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-GENERIC-DOMAIN-BOUNDARY",
        description: "Synthetic generic invoice outside the Shuttle domain",
        amount: 100_000,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PAY-GENERIC-DOMAIN-BOUNDARY",
        amount: 10_000,
        method: "TRANSFER",
      },
    });
    const auditBefore = await prisma.auditLog.count({ where: { tenantId: account.tenantId } });
    const csrf = signed.body.csrfToken as string;

    await agent.post(`/api/v1/billing/invoices/${invoice.id}/void`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ reason: "Synthetic generic boundary" }).expect(404);
    await agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 1, method: "CASH", reference: "PAY-GENERIC-REJECT" }).expect(404);
    await agent.post(`/api/v1/billing/payments/${payment.id}/verify`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({}).expect(404);
    await agent.post(`/api/v1/billing/payments/${payment.id}/reverse`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ reason: "Synthetic generic boundary" }).expect(404);
    await foreignAgent.post(`/api/v1/billing/payments/${payment.id}/verify`).set("Origin", origin).set("X-Novo-Csrf", foreignSigned.body.csrfToken as string).send({}).expect(404);

    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "ISSUED", shuttleBillingPeriodId: null });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: null, verifiedAt: null, reversedAt: null });
    expect(await prisma.auditLog.count({ where: { tenantId: account.tenantId } })).toBe(auditBefore);
  });

  it("replays only an eligible identical Shuttle payment reference and freezes a settled period", async () => {
    const account = await createAccount("shuttle-payment-reference-boundary");
    const agent = request.agent(app);
    const signed = await login(agent, account);
    const csrf = signed.body.csrfToken as string;
    const { invoice, period } = await createCollectibleShuttleInvoiceFixture(
      account,
      "REFERENCE-BOUNDARY",
      100_000,
    );

    const first = await agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 60_000, method: "TRANSFER", reference: "PAY-REFERENCE-BOUNDARY" }).expect(201);
    await agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 60_000, method: "TRANSFER", reference: "PAY-REFERENCE-BOUNDARY" }).expect(200).expect((response) => expect(response.body).toMatchObject({ id: first.body.id, idempotentReplay: true }));
    await agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 59_999, method: "TRANSFER", reference: "PAY-REFERENCE-BOUNDARY" }).expect(409).expect((response) => expect(response.body.error.code).toBe("PAYMENT_REFERENCE_REUSED"));
    await agent.post(`/api/v1/billing/payments/${first.body.id}/reverse`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ reason: "Synthetic reference reversal" }).expect(200);
    await agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 60_000, method: "TRANSFER", reference: "PAY-REFERENCE-BOUNDARY" }).expect(409).expect((response) => expect(response.body.error.code).toBe("PAYMENT_REFERENCE_REUSED"));

    await prisma.shuttleFinancialConfig.create({
      data: { tenantId: account.tenantId, vendorName: "Synthetic boundary vendor", vendorShareBps: 6_000, cooperativeShareBps: 4_000 },
    });
    await agent.post(`/api/v1/shuttle/billing-periods/${period.id}/settlements`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({}).expect(201);
    const recorded = await prisma.payment.create({
      data: { tenantId: account.tenantId, invoiceId: invoice.id, reference: "PAY-REFERENCE-RECORDED", amount: 1, method: "CASH", status: "RECORDED" },
    });
    await agent.post(`/api/v1/billing/invoices/${invoice.id}/payments`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({ amount: 1, method: "CASH", reference: "PAY-REFERENCE-SETTLED" }).expect(409).expect((response) => expect(response.body.error.code).toBe("BILLING_PERIOD_SETTLED"));
    await agent.post(`/api/v1/billing/payments/${recorded.id}/verify`).set("Origin", origin).set("X-Novo-Csrf", csrf).send({}).expect(409).expect((response) => expect(response.body.error.code).toBe("BILLING_PERIOD_SETTLED"));
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(2);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: recorded.id } })).toMatchObject({ status: "RECORDED", verifiedAt: null });
  });

  it("enforces migration 011 tenant, parent-reparenting, and verified-allocation guards through direct database writes", async () => {
    const account = await createAccount("shuttle-migration-011-guards");
    const foreign = await createAccount("shuttle-migration-011-guards-foreign");
    const { invoice, period } = await createCollectibleShuttleInvoiceFixture(
      account,
      "MIGRATION-011",
      100_000,
    );
    const genericInvoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-MIGRATION-011-GENERIC",
        description: "Synthetic cross-tenant payment guard",
        amount: 1,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    await expectPostgresCheckConstraint(
      () => prisma.payment.create({
        data: {
          tenantId: foreign.tenantId,
          invoiceId: genericInvoice.id,
          reference: "PAY-MIGRATION-011-CROSS-TENANT",
          amount: 1,
          method: "TRANSFER",
        },
      }),
      "Payment_invoice_tenant_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.payment.create({
        data: {
          tenantId: account.tenantId,
          invoiceId: genericInvoice.id,
          reference: "PAY-MIGRATION-011-GENERIC-STATUS",
          amount: 1,
          method: "TRANSFER",
          status: "VERIFIED",
        },
      }),
      "Payment_generic_status_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.payment.create({
        data: {
          tenantId: account.tenantId,
          invoiceId: invoice.id,
          reference: "PAY-MIGRATION-011-SHUTTLE-NULL",
          amount: 1,
          method: "TRANSFER",
        },
      }),
      "Payment_shuttle_status_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.$executeRaw(Prisma.sql`UPDATE "ShuttleBillingPeriod" SET "tenantId" = ${foreign.tenantId} WHERE "id" = ${period.id}`),
      "ShuttleFinancial_parent_tenant_reparenting_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.$executeRaw(Prisma.sql`UPDATE "ShuttleBillingPeriod" SET "endsAt" = "endsAt" + interval '1 day' WHERE "id" = ${period.id}`),
      "ShuttleBillingPeriod_finalized_immutability_check",
    );

    const settlement = await prisma.shuttleSettlement.create({
      data: {
        tenantId: account.tenantId,
        billingPeriodId: period.id,
        vendorNameSnapshot: "Synthetic migration guard vendor",
        vendorShareBps: 6_000,
        cooperativeShareBps: 4_000,
        verifiedAmount: 0,
        vendorAmount: 0,
        cooperativeAmount: 0,
      },
    });
    const recordedPayment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PAY-MIGRATION-011-RECORDED",
        amount: 1,
        method: "CASH",
        status: "RECORDED",
      },
    });
    await expectPostgresCheckConstraint(
      () => prisma.shuttleSettlementPayment.create({
        data: { settlementId: settlement.id, paymentId: recordedPayment.id },
      }),
      "ShuttleSettlementPayment_tenant_period_check",
    );
    const verifiedPayment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PAY-MIGRATION-011-VERIFIED",
        amount: 1,
        method: "TRANSFER",
        status: "VERIFIED",
      },
    });
    await prisma.shuttleSettlementPayment.create({
      data: { settlementId: settlement.id, paymentId: verifiedPayment.id },
    });
    await expectPostgresCheckConstraint(
      () => prisma.$executeRaw(Prisma.sql`UPDATE "Payment" SET "status" = 'REVERSED'::"ShuttlePaymentStatus" WHERE "id" = ${verifiedPayment.id}`),
      "Payment_settled_snapshot_immutability_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.$executeRaw(Prisma.sql`UPDATE "Payment" SET "amount" = 2 WHERE "id" = ${verifiedPayment.id}`),
      "Payment_settled_snapshot_immutability_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.$executeRaw(Prisma.sql`UPDATE "Invoice" SET "amount" = 2, "routeNameSnapshot" = 'tampered' WHERE "id" = ${invoice.id}`),
      "Invoice_settled_snapshot_immutability_check",
    );
    await expectPostgresCheckConstraint(
      () => prisma.$executeRaw(Prisma.sql`UPDATE "ShuttleSettlement" SET "vendorAmount" = 1 WHERE "id" = ${settlement.id}`),
      "ShuttleSettlement_snapshot_immutability_check",
    );
    // No DELETE trigger is installed: the integration harness must remove
    // allocations before parents during isolated fixture cleanup. D05 has not
    // approved a production settlement-correction/deallocation workflow.
    await prisma.shuttleSettlementPayment.delete({
      where: {
        settlementId_paymentId: {
          settlementId: settlement.id,
          paymentId: verifiedPayment.id,
        },
      },
    });
    expect(
      await prisma.shuttleSettlementPayment.count({
        where: { settlementId: settlement.id, paymentId: verifiedPayment.id },
      }),
    ).toBe(0);
  });

  it("reconciles a complete Shuttle subscription-to-settlement journey with exact whole Rupiah", async () => {
    const finance = await createAccount("shuttle-full-financial-journey", "OWNER");
    const cashier = await createTenantUser(finance, "shuttle-journey-cashier", "CASHIER");
    const financeAgent = request.agent(app);
    const cashierAgent = request.agent(app);
    const financeLogin = await login(financeAgent, finance);
    const cashierLogin = await login(cashierAgent, cashier);
    const financeCsrf = financeLogin.body.csrfToken as string;
    const cashierCsrf = cashierLogin.body.csrfToken as string;
    const member = await createEligibleShuttleMember(finance, "FULL-JOURNEY");

    const route = await financeAgent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({
        code: "SH-FULL-JOURNEY",
        name: "Full Journey Route",
        stops: ["Synthetic Terminal", "Synthetic School"],
        monthlyRate: 100000,
      })
      .expect(201);
    const subscription = await financeAgent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({ memberId: member.id, routeId: route.body.id, startDate: "2026-11-01" })
      .expect(201);
    const period = await financeAgent
      .post("/api/v1/shuttle/billing-periods")
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({ year: 2026, month: 11 })
      .expect(201);
    await financeAgent
      .put("/api/v1/shuttle/financial-config")
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({ vendorName: "Synthetic Journey Vendor", vendorShareBps: 6000, cooperativeShareBps: 4000 })
      .expect(200);
    await financeAgent
      .post(`/api/v1/shuttle/billing-periods/${period.body.id}/generate`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({})
      .expect(200)
      .expect((response) => expect(response.body.created).toBe(1));

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { tenantId: finance.tenantId, subscriptionId: subscription.body.id, shuttleBillingPeriodId: period.body.id },
    });
    expect(invoice).toMatchObject({ status: "DRAFT", routeCodeSnapshot: "SH-FULL-JOURNEY", rateSnapshot: expect.anything(), proratedDays: 30, periodDays: 30 });
    expect(invoice.amount.toString()).toBe("100000");
    await financeAgent
      .post(`/api/v1/shuttle/billing-periods/${period.body.id}/finalize`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({})
      .expect(200)
      .expect((response) => expect(response.body.status).toBe("FINALIZED"));

    for (const [amount, reference] of [[60000, "PAY-JOURNEY-60"], [40000, "PAY-JOURNEY-40"]] as const) {
      await cashierAgent
        .post(`/api/v1/billing/invoices/${invoice.id}/payments`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", cashierCsrf)
        .send({ amount, method: "TRANSFER", reference })
        .expect(201)
        .expect((response) => expect(response.body.status).toBe("RECORDED"));
    }
    expect(
      await prisma.payment.count({ where: { invoiceId: invoice.id, status: "RECORDED" } }),
    ).toBe(2);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("ISSUED");

    const recorded = await prisma.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: { reference: "asc" } });
    for (const payment of recorded) {
      await financeAgent
        .post(`/api/v1/billing/payments/${payment.id}/verify`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", financeCsrf)
        .send({})
        .expect(200)
        .expect((response) => expect(response.body.status).toBe("VERIFIED"));
    }
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
    expect((await prisma.payment.aggregate({ where: { invoiceId: invoice.id, status: "VERIFIED" }, _sum: { amount: true } }))._sum.amount?.toString()).toBe("100000");

    const settlement = await financeAgent
      .post(`/api/v1/shuttle/billing-periods/${period.body.id}/settlements`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({})
      .expect(201);
    expect(settlement.body).toMatchObject({ status: "DRAFT", verifiedAmount: 100000, vendorAmount: 60000, cooperativeAmount: 40000 });
    expect(typeof settlement.body.verifiedAmount).toBe("number");
    expect(typeof settlement.body.vendorAmount).toBe("number");
    expect(typeof settlement.body.cooperativeAmount).toBe("number");
    expect(BigInt(settlement.body.vendorAmount) + BigInt(settlement.body.cooperativeAmount)).toBe(BigInt(settlement.body.verifiedAmount));
    expect(await prisma.shuttleSettlementPayment.count({ where: { settlementId: settlement.body.id } })).toBe(2);
    const settlementList = await financeAgent.get("/api/v1/shuttle/settlements").expect(200);
    expect(settlementList.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: settlement.body.id, verifiedAmount: 100000, vendorAmount: 60000, cooperativeAmount: 40000 }),
    ]));
    await financeAgent
      .post(`/api/v1/billing/payments/${recorded[0]!.id}/reverse`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({ reason: "Must not reverse allocated payment" })
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("PAYMENT_ALLOCATED_TO_SETTLEMENT"));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: recorded[0]!.id } })).status).toBe("VERIFIED");

    const approvedSettlement = await financeAgent
      .post(`/api/v1/shuttle/settlements/${settlement.body.id}/approve`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({})
      .expect(200);
    expect(approvedSettlement.body).toMatchObject({ status: "APPROVED", verifiedAmount: 100000, vendorAmount: 60000, cooperativeAmount: 40000 });
    const paidSettlement = await financeAgent
      .post(`/api/v1/shuttle/settlements/${settlement.body.id}/mark-paid`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", financeCsrf)
      .send({ reference: "SETTLEMENT-JOURNEY-01" })
      .expect(200);
    expect(paidSettlement.body).toMatchObject({ status: "PAID", verifiedAmount: 100000, vendorAmount: 60000, cooperativeAmount: 40000 });

    const report = await financeAgent.get("/api/v1/shuttle/report").expect(200);
    expect(report.body).toMatchObject({ billed: 100000, paid: 100000, outstanding: 0, vendorShare: 60000, cooperativeShare: 40000 });
    expect(report.body.settlements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: settlement.body.id, verifiedAmount: 100000, vendorAmount: 60000, cooperativeAmount: 40000 }),
    ]));
    for (const action of ["create", "generate", "finalize", "record_payment", "verify", "approve", "mark_paid"]) {
      expect(await prisma.auditLog.count({ where: { tenantId: finance.tenantId, action } })).toBeGreaterThan(0);
    }
  });

  it("rejects repeated and concurrent duplicate active subscription requests", async () => {
    const account = await createAccount("shuttle-duplicate-active");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const member = await createEligibleShuttleMember(account, "DUPLICATE");
    const route = await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        code: "SH-DUPLICATE",
        name: "Duplicate Guard Route",
        stops: ["Synthetic Stop", "School"],
        monthlyRate: 100000,
      })
      .expect(201);
    const body = {
      memberId: member.id,
      routeId: route.body.id,
      startDate: "2026-11-01",
    };

    const concurrent = await Promise.all([
      agent
        .post("/api/v1/shuttle/subscriptions")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send(body),
      agent
        .post("/api/v1/shuttle/subscriptions")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send(body),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      concurrent.find((response) => response.status === 409)?.body.error.code,
    ).toBe("DUPLICATE_ACTIVE_SUBSCRIPTION");
    expect(
      await prisma.shuttleSubscription.count({
        where: {
          tenantId: account.tenantId,
          memberId: member.id,
          routeId: route.body.id,
          status: "ACTIVE",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "ShuttleSubscription",
          action: "create",
        },
      }),
    ).toBe(1);

    const replay = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(body)
      .expect(409);
    expect(replay.body.error.code).toBe("DUPLICATE_ACTIVE_SUBSCRIPTION");
  });

  it("enforces active student uniqueness through both the API and PostgreSQL partial indexes", async () => {
    const account = await createAccount("shuttle-student-unique");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const [route, student] = await Promise.all([
      prisma.shuttleRoute.create({
        data: {
          tenantId: account.tenantId,
          code: "SH-STUDENT-UNIQUE",
          name: "Student Uniqueness Route",
          stops: ["Synthetic Stop", "School"],
          monthlyRate: 100000,
        },
      }),
      prisma.masterDataRecord.create({
        data: {
          tenantId: account.tenantId,
          type: "STUDENT",
          identifier: "STUDENT-UNIQUE",
          fullName: "Synthetic Unique Student",
        },
      }),
    ]);
    const body = {
      studentIdentityId: student.id,
      routeId: route.id,
      startDate: "2026-11-01",
    };
    await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(body)
      .expect(201);
    const duplicate = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(body)
      .expect(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_ACTIVE_SUBSCRIPTION");

    const otherRoute = await prisma.shuttleRoute.create({
      data: {
        tenantId: account.tenantId,
        code: "SH-STUDENT-OTHER",
        name: "Different Route",
        stops: ["Synthetic Stop", "School"],
        monthlyRate: 100000,
      },
    });
    await prisma.shuttleSubscription.create({
      data: {
        tenantId: account.tenantId,
        studentIdentityId: student.id,
        routeId: otherRoute.id,
        startDate: new Date("2026-11-01T00:00:00.000Z"),
      },
    });

    await expect(
      prisma.shuttleSubscription.create({
        data: {
          tenantId: account.tenantId,
          studentIdentityId: student.id,
          routeId: route.id,
          startDate: new Date("2026-11-02T00:00:00.000Z"),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const member = await createEligibleShuttleMember(account, "DIRECT-UNIQUE");
    const memberRoute = await prisma.shuttleRoute.create({
      data: {
        tenantId: account.tenantId,
        code: "SH-MEMBER-UNIQUE",
        name: "Member Uniqueness Route",
        stops: ["Synthetic Stop", "School"],
        monthlyRate: 100000,
      },
    });
    await prisma.shuttleSubscription.create({
      data: {
        tenantId: account.tenantId,
        memberId: member.id,
        routeId: memberRoute.id,
        startDate: new Date("2026-11-01T00:00:00.000Z"),
      },
    });
    await expect(
      prisma.shuttleSubscription.create({
        data: {
          tenantId: account.tenantId,
          memberId: member.id,
          routeId: memberRoute.id,
          startDate: new Date("2026-11-02T00:00:00.000Z"),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cancels a subscription once with tenant, RBAC, CSRF, audit, and invoice guards", async () => {
    const account = await createAccount("shuttle-cancel-subscription");
    const foreign = await createAccount("shuttle-cancel-foreign");
    const viewer = await createTenantUser(account, "shuttle-cancel-viewer", "VIEWER");
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const foreignSignedIn = await login(foreignAgent, foreign);
    const viewerSignedIn = await login(viewerAgent, viewer);
    const csrf = signedIn.body.csrfToken as string;
    const foreignCsrf = foreignSignedIn.body.csrfToken as string;
    const viewerCsrf = viewerSignedIn.body.csrfToken as string;
    const member = await createEligibleShuttleMember(account, "CANCEL");
    const route = await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        code: "SH-CANCEL",
        name: "Cancellation Route",
        stops: ["Synthetic Stop", "School"],
        monthlyRate: 100000,
      })
      .expect(201);
    const subscription = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ memberId: member.id, routeId: route.body.id, startDate: "2026-11-01" })
      .expect(201);
    const path = `/api/v1/shuttle/subscriptions/${subscription.body.id}/cancel`;
    const payload = { reason: "Duplicate historical subscription correction" };

    await agent.post(path).set("Origin", origin).send(payload).expect(403);
    await viewerAgent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", viewerCsrf)
      .send(payload)
      .expect(403);
    await foreignAgent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send(payload)
      .expect(404);

    const responses = await Promise.all([
      agent.post(path).set("Origin", origin).set("X-Novo-Csrf", csrf).send(payload),
      agent.post(path).set("Origin", origin).set("X-Novo-Csrf", csrf).send(payload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
    expect(
      (
        await prisma.shuttleSubscription.findUniqueOrThrow({
          where: { id: subscription.body.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "ShuttleSubscription",
          entityId: subscription.body.id,
          action: "cancel",
        },
      }),
    ).toBe(1);
    await agent
      .post(`/api/v1/shuttle/subscriptions/${subscription.body.id}/invoices`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({})
      .expect(409);
    const replacement = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ memberId: member.id, routeId: route.body.id, startDate: "2026-12-01" })
      .expect(201);
    expect(replacement.body.status).toBe("ACTIVE");
  });

  it("voids only unpaid, unsettled invoices and excludes void invoices from Shuttle reporting", async () => {
    const account = await createAccount("shuttle-void-invoice");
    const foreign = await createAccount("shuttle-void-foreign");
    const viewer = await createTenantUser(account, "shuttle-void-viewer", "VIEWER");
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    const signedIn = await login(agent, account);
    const foreignSignedIn = await login(foreignAgent, foreign);
    const viewerSignedIn = await login(viewerAgent, viewer);
    const csrf = signedIn.body.csrfToken as string;
    const foreignCsrf = foreignSignedIn.body.csrfToken as string;
    const viewerCsrf = viewerSignedIn.body.csrfToken as string;
    const period = await prisma.shuttleBillingPeriod.create({
      data: {
        tenantId: account.tenantId,
        startsAt: new Date("2026-11-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-01T00:00:00.000Z"),
      },
    });
    const route = await prisma.shuttleRoute.create({
      data: { tenantId: account.tenantId, code: "VOID-01", name: "Void Regression Route", stops: ["Synthetic Start", "Synthetic School"], monthlyRate: 300000 },
    });
    const subscriptions = await Promise.all(["VOIDABLE", "PAID", "SETTLED", "OPEN"].map(async (suffix) => {
      const member = await createEligibleShuttleMember(account, `VOID-${suffix}`);
      return prisma.shuttleSubscription.create({ data: { tenantId: account.tenantId, memberId: member.id, routeId: route.id, startDate: new Date("2026-11-01T00:00:00.000Z"), effectiveMonthlyRate: 300000 } });
    }));
    const invoiceData = {
      tenantId: account.tenantId,
      shuttleBillingPeriodId: period.id,
      description: "Synthetic invoice correction",
      status: "ISSUED" as const,
      issuedAt: new Date("2026-11-03T00:00:00.000Z"),
      routeCodeSnapshot: route.code,
      routeNameSnapshot: route.name,
      rateSnapshot: 300000,
      proratedDays: 30,
      periodDays: 30,
    };
    const [voidable, paid, settled, open] = await Promise.all([
      prisma.invoice.create({ data: { ...invoiceData, subscriptionId: subscriptions[0]!.id, invoiceNo: "INV-VOIDABLE", amount: 125000 } }),
      prisma.invoice.create({ data: { ...invoiceData, subscriptionId: subscriptions[1]!.id, invoiceNo: "INV-PAID", amount: 200000 } }),
      prisma.invoice.create({ data: { ...invoiceData, subscriptionId: subscriptions[2]!.id, invoiceNo: "INV-SETTLED", amount: 50000 } }),
      prisma.invoice.create({ data: { ...invoiceData, subscriptionId: subscriptions[3]!.id, invoiceNo: "INV-OPEN", amount: 300000 } }),
    ]);
    const [paidPayment, settledPayment, openPayment] = await Promise.all([
      prisma.payment.create({ data: { tenantId: account.tenantId, invoiceId: paid.id, reference: "PAY-VOID-PAID", amount: 200000, method: "TRANSFER", status: "VERIFIED" } }),
      prisma.payment.create({ data: { tenantId: account.tenantId, invoiceId: settled.id, reference: "PAY-VOID-SETTLED", amount: 50000, method: "TRANSFER", status: "VERIFIED" } }),
      prisma.payment.create({ data: { tenantId: account.tenantId, invoiceId: open.id, reference: "PAY-VOID-OPEN", amount: 100000, method: "TRANSFER", status: "VERIFIED" } }),
    ]);
    const settlement = await prisma.shuttleSettlement.create({
      data: {
        tenantId: account.tenantId,
        billingPeriodId: period.id,
        vendorNameSnapshot: "Synthetic Vendor",
        vendorShareBps: 6000,
        cooperativeShareBps: 4000,
        verifiedAmount: 50000,
        vendorAmount: 30000,
        cooperativeAmount: 20000,
        payments: { create: { paymentId: settledPayment.id } },
      },
    });
    expect(settlement.id).toEqual(expect.any(String));
    expect(paidPayment.id).toEqual(expect.any(String));
    expect(openPayment.id).toEqual(expect.any(String));
    const voidPath = `/api/v1/billing/invoices/${voidable.id}/void`;
    const payload = { reason: "Duplicate historical invoice correction" };

    await agent.post(voidPath).set("Origin", origin).send(payload).expect(403);
    await viewerAgent
      .post(voidPath)
      .set("Origin", origin)
      .set("X-Novo-Csrf", viewerCsrf)
      .send(payload)
      .expect(403);
    await foreignAgent
      .post(voidPath)
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignCsrf)
      .send(payload)
      .expect(404);
    await agent
      .post(`/api/v1/billing/invoices/${paid.id}/void`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(payload)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("INVOICE_HAS_PAYMENTS"));
    await agent
      .post(`/api/v1/billing/invoices/${settled.id}/void`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send(payload)
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe("INVOICE_SETTLED"));

    const responses = await Promise.all([
      agent.post(voidPath).set("Origin", origin).set("X-Novo-Csrf", csrf).send(payload),
      agent.post(voidPath).set("Origin", origin).set("X-Novo-Csrf", csrf).send(payload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: voidable.id } })).status).toBe("VOID");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("ISSUED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: settled.id } })).status).toBe("ISSUED");
    expect(
      await prisma.auditLog.count({
        where: { tenantId: account.tenantId, entityType: "Invoice", entityId: voidable.id, action: "void" },
      }),
    ).toBe(1);

    const report = await agent.get("/api/v1/shuttle/report").expect(200);
    expect(report.body).toMatchObject({ billed: 550000, paid: 350000, outstanding: 200000 });
  });

  it("rolls back subscription cancellation and invoice void when their audit write fails", async () => {
    const account = await createAccount("shuttle-correction-audit-rollback");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const member = await createEligibleShuttleMember(account, "CORRECTION-ROLLBACK");
    const route = await prisma.shuttleRoute.create({
      data: {
        tenantId: account.tenantId,
        code: "SH-CORRECTION-ROLLBACK",
        name: "Correction Rollback Route",
        stops: ["Synthetic Stop", "School"],
        monthlyRate: 100000,
      },
    });
    const subscription = await prisma.shuttleSubscription.create({
      data: {
        tenantId: account.tenantId,
        memberId: member.id,
        routeId: route.id,
        startDate: new Date("2026-11-01T00:00:00.000Z"),
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        subscriptionId: subscription.id,
        invoiceNo: "INV-CORRECTION-ROLLBACK",
        description: "Synthetic correction rollback invoice",
        amount: 100000,
        status: "ISSUED",
        issuedAt: new Date("2026-11-03T00:00:00.000Z"),
      },
    });
    const cancellationPayload = { reason: "Synthetic cancellation rollback" };
    await withFailingShuttleAudit(
      account.tenantId,
      "ShuttleSubscription",
      "cancel",
      async () => {
        await agent
          .post(`/api/v1/shuttle/subscriptions/${subscription.id}/cancel`)
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .send(cancellationPayload)
          .expect(500);
      },
    );
    expect(
      (
        await prisma.shuttleSubscription.findUniqueOrThrow({
          where: { id: subscription.id },
        })
      ).status,
    ).toBe("ACTIVE");
    expect(
      await prisma.auditLog.count({
        where: { tenantId: account.tenantId, entityType: "ShuttleSubscription", entityId: subscription.id, action: "cancel" },
      }),
    ).toBe(0);

    const voidPayload = { reason: "Synthetic invoice void rollback" };
    await withFailingShuttleAudit(account.tenantId, "Invoice", "void", async () => {
      await agent
        .post(`/api/v1/billing/invoices/${invoice.id}/void`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send(voidPayload)
        .expect(500);
    });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("ISSUED");
    expect(
      await prisma.auditLog.count({
        where: { tenantId: account.tenantId, entityType: "Invoice", entityId: invoice.id, action: "void" },
      }),
    ).toBe(0);
  });
});

describe("Sprint 05 Shuttle settlement lifecycle", () => {
  it("allocates only verified payment once and rejects reversal after settlement allocation", async () => {
    const account = await createAccount("shuttle-settlement-lifecycle");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;
    const student = await prisma.masterDataRecord.create({
      data: {
        tenantId: account.tenantId,
        type: "STUDENT",
        identifier: "STUDENT-SETTLE",
        fullName: "Synthetic Student",
      },
    });
    const route = await agent
      .post("/api/v1/shuttle/routes")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        code: "SETTLE-01",
        name: "Settlement Route",
        stops: ["Start", "School"],
        monthlyRate: 100000,
      })
      .expect(201);
    const subscription = await agent
      .post("/api/v1/shuttle/subscriptions")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        studentIdentityId: student.id,
        routeId: route.body.id,
        startDate: "2026-11-01",
        payerName: "Synthetic Guardian",
      })
      .expect(201);
    const period = await agent
      .post("/api/v1/shuttle/billing-periods")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ year: 2026, month: 11 })
      .expect(201);
    await agent
      .put("/api/v1/shuttle/financial-config")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        vendorName: "Synthetic Vendor",
        vendorShareBps: 6000,
        cooperativeShareBps: 4000,
      })
      .expect(200);
    await agent
      .post(`/api/v1/shuttle/billing-periods/${period.body.id}/generate`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({})
      .expect(200);
    await agent
      .post(`/api/v1/shuttle/billing-periods/${period.body.id}/finalize`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({})
      .expect(200);
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: {
        tenantId: account.tenantId,
        subscriptionId: subscription.body.id,
        shuttleBillingPeriodId: period.body.id,
      },
    });
    const payment = await agent
      .post(`/api/v1/billing/invoices/${invoice.id}/payments`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        amount: 100000,
        method: "TRANSFER",
        reference: "SETTLEMENT-PAYMENT-01",
      })
      .expect(201);
    const [first, replay] = await Promise.all([
      agent
        .post(`/api/v1/shuttle/billing-periods/${period.body.id}/settlements`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({}),
      agent
        .post(`/api/v1/shuttle/billing-periods/${period.body.id}/settlements`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({}),
    ]);
    expect([first.status, replay.status].sort()).toEqual([201, 201]);
    expect(replay.body.id).toBe(first.body.id);
    expect(
      BigInt(first.body.vendorAmount) + BigInt(first.body.cooperativeAmount),
    ).toBe(100000n);
    expect(
      await prisma.shuttleSettlementPayment.count({
        where: { paymentId: payment.body.id },
      }),
    ).toBe(1);
    const auditsBeforeReverse = await prisma.auditLog.count({
      where: {
        tenantId: account.tenantId,
        entityType: "Payment",
        entityId: payment.body.id,
      },
    });
    const rejectedReverse = await agent
      .post(`/api/v1/billing/payments/${payment.body.id}/reverse`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ reason: "Synthetic correction" })
      .expect(409);
    expect(rejectedReverse.body.error.code).toBe(
      "PAYMENT_ALLOCATED_TO_SETTLEMENT",
    );
    expect(
      (
        await prisma.payment.findUniqueOrThrow({
          where: { id: payment.body.id },
        })
      ).status,
    ).toBe("VERIFIED");
    expect(
      await prisma.shuttleSettlement.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Payment",
          entityId: payment.body.id,
        },
      }),
    ).toBe(auditsBeforeReverse);
  });
});

describe("Sprint 05 Shuttle financial concurrency", () => {
  it("records one verification when two finance sessions verify the same recorded payment concurrently", async () => {
    const account = await createAccount("shuttle-concurrent-verification");
    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);
    const [firstSession, secondSession] = await Promise.all([
      login(firstAgent, account),
      login(secondAgent, account),
    ]);
    const { invoice } = await createCollectibleShuttleInvoiceFixture(
      account,
      "VERIFY-RACE-01",
      100_000,
    );
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PAY-VERIFY-RACE-01",
        amount: 100_000,
        method: "TRANSFER",
        status: "RECORDED",
      },
    });

    const responses = await Promise.all([
      firstAgent
        .post(`/api/v1/billing/payments/${payment.id}/verify`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", firstSession.body.csrfToken as string),
      secondAgent
        .post(`/api/v1/billing/payments/${payment.id}/verify`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", secondSession.body.csrfToken as string),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const persistedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const persistedInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { payments: true },
    });
    expect(persistedPayment.status).toBe("VERIFIED");
    expect(persistedPayment.verifiedAt).not.toBeNull();
    expect(persistedInvoice.status).toBe("PAID");
    expect(
      persistedInvoice.payments
        .filter((item) => item.status === "VERIFIED")
        .reduce((total, item) => total + BigInt(item.amount.toString()), 0n),
    ).toBe(100_000n);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Payment",
          entityId: payment.id,
          action: "verify",
        },
      }),
    ).toBe(1);
  });

  it("keeps reversal and settlement mutually exclusive across repeated concurrent interleavings", async () => {
    for (const iteration of [1, 2, 3]) {
      const account = await createAccount(
        `shuttle-reversal-settlement-${iteration}`,
      );
      const reverseAgent = request.agent(app);
      const settlementAgent = request.agent(app);
      const [reverseSession, settlementSession] = await Promise.all([
        login(reverseAgent, account),
        login(settlementAgent, account),
      ]);
      const { period, invoice, payment } =
        await createFinalizedShuttlePaymentFixture(account, String(iteration));

      const [reverseResponse, settlementResponse] = await Promise.all([
        reverseAgent
          .post(`/api/v1/billing/payments/${payment.id}/reverse`)
          .set("Origin", origin)
          .set("X-Novo-Csrf", reverseSession.body.csrfToken as string)
          .send({ reason: "Synthetic race correction" }),
        settlementAgent
          .post(`/api/v1/shuttle/billing-periods/${period.id}/settlements`)
          .set("Origin", origin)
          .set("X-Novo-Csrf", settlementSession.body.csrfToken as string)
          .send({}),
      ]);

      expect(settlementResponse.status).toBe(201);
      const persistedPayment = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const persistedInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      const settlements = await prisma.shuttleSettlement.findMany({
        where: { tenantId: account.tenantId, billingPeriodId: period.id },
      });
      const allocations = await prisma.shuttleSettlementPayment.findMany({
        where: { paymentId: payment.id },
      });
      const paymentAudits = await prisma.auditLog.findMany({
        where: {
          tenantId: account.tenantId,
          entityType: "Payment",
          entityId: payment.id,
        },
        orderBy: { createdAt: "asc" },
      });
      const settlementAudits = await prisma.auditLog.findMany({
        where: { tenantId: account.tenantId, entityType: "ShuttleSettlement" },
      });

      expect(settlements).toHaveLength(1);
      expect(settlementAudits).toHaveLength(1);
      const settlement = settlements[0]!;
      expect(
        BigInt(settlement.vendorAmount.toString()) +
          BigInt(settlement.cooperativeAmount.toString()),
      ).toBe(BigInt(settlement.verifiedAmount.toString()));

      if (persistedPayment.status === "REVERSED") {
        expect(reverseResponse.status).toBe(200);
        expect(persistedInvoice.status).toBe("ISSUED");
        expect(allocations).toHaveLength(0);
        expect(settlement.verifiedAmount.toString()).toBe("0");
        expect(paymentAudits.map((audit) => audit.action)).toEqual(["reverse"]);
      } else {
        expect(persistedPayment.status).toBe("VERIFIED");
        expect(persistedInvoice.status).toBe("PAID");
        expect(reverseResponse.status).toBe(409);
        expect(reverseResponse.body.error.code).toBe(
          "PAYMENT_ALLOCATED_TO_SETTLEMENT",
        );
        expect(allocations).toHaveLength(1);
        expect(settlement.verifiedAmount.toString()).toBe("100000");
        expect(paymentAudits).toHaveLength(0);
      }
    }
  });
});

describe("Sprint 05 Payment proof isolation", () => {
  it("stores a valid Payment proof privately without exposing storage metadata or crossing tenants", async () => {
    const account = await createAccount("payment-proof-owner");
    const foreign = await createAccount("payment-proof-foreign");
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const signed = await login(agent, account);
    const foreignSigned = await login(foreignAgent, foreign);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-PROOF-01",
        description: "Synthetic proof",
        amount: 10,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PROOF-001",
        amount: 10,
        method: "TRANSFER",
      },
    });
    let storageKey: string | undefined;
    try {
      const uploaded = await agent
        .post("/api/v1/attachments")
        .set("Origin", origin)
        .set("X-Novo-Csrf", signed.body.csrfToken as string)
        .field("entityType", "Payment")
        .field("entityId", payment.id)
        .attach("file", Buffer.from("%PDF-1.4\nsynthetic proof"), {
          filename: "proof.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      expect(uploaded.body.storageKey).toBeUndefined();
      expect(uploaded.body.sha256).toBeUndefined();
      expect(uploaded.body.entityId).toBe(payment.id);
      const saved = await prisma.attachment.findUniqueOrThrow({
        where: { id: uploaded.body.id },
      });
      storageKey = saved.storageKey;
      await agent.get(`/api/v1/attachments/${saved.id}/download`).expect(200);
      await foreignAgent
        .get(`/api/v1/attachments/${saved.id}/download`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", foreignSigned.body.csrfToken as string)
        .expect(404);
    } finally {
      if (storageKey)
        await rm(path.join(env.UPLOAD_DIR, storageKey), { force: true });
    }
  });
  it("rolls back payment-proof metadata and removes moved file when Attachment audit insertion fails", async () => {
    const account = await createAccount("payment-proof-audit-failure");
    const agent = request.agent(app);
    const signed = await login(agent, account);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-PROOF-AUDIT",
        description: "Synthetic audit failure",
        amount: 10,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PROOF-AUDIT-001",
        amount: 10,
        method: "TRANSFER",
      },
    });
    await mkdir(env.UPLOAD_DIR, { recursive: true });
    const before = new Set(await readdir(env.UPLOAD_DIR));
    await withFailingShuttleAudit(
      account.tenantId,
      "Attachment",
      "upload",
      async () => {
        await agent
          .post("/api/v1/attachments")
          .set("Origin", origin)
          .set("X-Novo-Csrf", signed.body.csrfToken as string)
          .field("entityType", "Payment")
          .field("entityId", payment.id)
          .attach("file", Buffer.from("%PDF-1.4\nforced audit failure"), {
            filename: "rollback.pdf",
            contentType: "application/pdf",
          })
          .expect(500);
      },
    );
    expect(
      await prisma.attachment.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Payment",
          entityId: payment.id,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityType: "Attachment",
          action: "upload",
        },
      }),
    ).toBe(0);
    expect(new Set(await readdir(env.UPLOAD_DIR))).toEqual(before);
  });
  it("rejects unauthorized, CSRF-invalid, and foreign or missing Payment proof parents without residual files", async () => {
    const account = await createAccount("payment-proof-negative");
    const foreign = await createAccount("payment-proof-negative-foreign");
    const viewer = await createTenantUser(
      account,
      "payment-proof-viewer",
      "VIEWER",
    );
    const agent = request.agent(app);
    const foreignAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    const signed = await login(agent, account);
    const foreignSigned = await login(foreignAgent, foreign);
    const viewerSigned = await login(viewerAgent, viewer);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-PROOF-NEG",
        description: "Synthetic negative",
        amount: 10,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PROOF-NEG-001",
        amount: 10,
        method: "TRANSFER",
      },
    });
    await mkdir(env.UPLOAD_DIR, { recursive: true });
    const before = new Set(await readdir(env.UPLOAD_DIR));
    await agent
      .post("/api/v1/attachments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", signed.body.csrfToken as string)
      .field("entityType", "Payment")
      .attach("file", Buffer.from("%PDF-1.4\ninvalid metadata proof"), {
        filename: "invalid-metadata.pdf",
        contentType: "application/pdf",
      })
      .expect(400);
    expect(await prisma.attachment.count({ where: { tenantId: account.tenantId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: account.tenantId, entityType: "Attachment", action: "upload" } })).toBe(0);
    expect(new Set(await readdir(env.UPLOAD_DIR))).toEqual(before);
    const attach = (
      client: ReturnType<typeof request.agent>,
      token: string | undefined,
      parentId: string,
      requestOrigin = origin,
    ) => {
      const call = client
        .post("/api/v1/attachments")
        .set("Origin", requestOrigin)
        .field("entityType", "Payment")
        .field("entityId", parentId)
        .attach("file", Buffer.from("%PDF-1.4\nnegative proof"), {
          filename: "negative.pdf",
          contentType: "application/pdf",
        });
      return token ? call.set("X-Novo-Csrf", token) : call;
    };
    await attach(
      viewerAgent,
      viewerSigned.body.csrfToken as string,
      payment.id,
    ).expect(403);
    await attach(agent, undefined, payment.id).expect(403);
    await attach(agent, "invalid-csrf", payment.id).expect(403);
    await attach(
      agent,
      signed.body.csrfToken as string,
      payment.id,
      "https://untrusted.example",
    ).expect(403);
    await attach(
      agent,
      signed.body.csrfToken as string,
      "ckxxxxxxxxxxxxxxxxxxxxxxxxx",
    ).expect(404);
    const foreignInvoice = await prisma.invoice.create({
      data: {
        tenantId: foreign.tenantId,
        invoiceNo: "INV-PROOF-FOREIGN",
        description: "Synthetic foreign",
        amount: 10,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const foreignPayment = await prisma.payment.create({
      data: {
        tenantId: foreign.tenantId,
        invoiceId: foreignInvoice.id,
        reference: "PROOF-FOREIGN-001",
        amount: 10,
        method: "TRANSFER",
      },
    });
    await attach(
      agent,
      signed.body.csrfToken as string,
      foreignPayment.id,
    ).expect(404);
    await foreignAgent
      .get(`/api/v1/attachments/${payment.id}/download`)
      .set("Origin", origin)
      .set("X-Novo-Csrf", foreignSigned.body.csrfToken as string)
      .expect(404);
    expect(
      await prisma.attachment.count({ where: { tenantId: account.tenantId } }),
    ).toBe(0);
    expect(new Set(await readdir(env.UPLOAD_DIR))).toEqual(before);
  });
  it("accepts each supported signature only with its matching MIME and extension", async () => {
    const account = await createAccount("payment-proof-signatures");
    const agent = request.agent(app);
    const signed = await login(agent, account);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-PROOF-SIG",
        description: "Synthetic signatures",
        amount: 10,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PROOF-SIG-001",
        amount: 10,
        method: "TRANSFER",
      },
    });
    const cases = [
      {
        name: "proof.pdf",
        type: "application/pdf",
        bytes: Buffer.from("%PDF-1.4\nproof"),
      },
      {
        name: "proof.jpg",
        type: "image/jpeg",
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      },
      {
        name: "proof.png",
        type: "image/png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      {
        name: "proof.webp",
        type: "image/webp",
        bytes: Buffer.from("RIFFxxxxWEBP"),
      },
    ];
    const keys: string[] = [];
    try {
      for (const item of cases) {
        const response = await agent
          .post("/api/v1/attachments")
          .set("Origin", origin)
          .set("X-Novo-Csrf", signed.body.csrfToken as string)
          .field("entityType", "Payment")
          .field("entityId", payment.id)
          .attach("file", item.bytes, {
            filename: item.name,
            contentType: item.type,
          })
          .expect(201);
        keys.push(
          (
            await prisma.attachment.findUniqueOrThrow({
              where: { id: response.body.id },
            })
          ).storageKey,
        );
      }
      await agent
        .post("/api/v1/attachments")
        .set("Origin", origin)
        .set("X-Novo-Csrf", signed.body.csrfToken as string)
        .field("entityType", "Payment")
        .field("entityId", payment.id)
        .attach("file", Buffer.from("%PDF-1.4\nwrong extension"), {
          filename: "wrong.png",
          contentType: "application/pdf",
        })
        .expect(400);
      expect(
        await prisma.attachment.count({
          where: { tenantId: account.tenantId },
        }),
      ).toBe(4);
    } finally {
      await Promise.all(
        keys.map((key) => rm(path.join(env.UPLOAD_DIR, key), { force: true })),
      );
    }
  });
  it("rejects unauthorized proof download and malformed or oversized uploads without residual state", async () => {
    const account = await createAccount("payment-proof-malformed");
    const viewer = await createTenantUser(
      account,
      "payment-proof-download-viewer",
      "VIEWER",
    );
    const agent = request.agent(app);
    const viewerAgent = request.agent(app);
    const signed = await login(agent, account);
    const viewerSigned = await login(viewerAgent, viewer);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: account.tenantId,
        invoiceNo: "INV-PROOF-BAD",
        description: "Synthetic malformed",
        amount: 10,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        reference: "PROOF-BAD-001",
        amount: 10,
        method: "TRANSFER",
      },
    });
    await mkdir(env.UPLOAD_DIR, { recursive: true });
    const beforeFiles = new Set(await readdir(env.UPLOAD_DIR));
    let key: string | undefined;
    try {
      const valid = await agent
        .post("/api/v1/attachments")
        .set("Origin", origin)
        .set("X-Novo-Csrf", signed.body.csrfToken as string)
        .field("entityType", "Payment")
        .field("entityId", payment.id)
        .attach("file", Buffer.from("%PDF-1.4\nvalid"), {
          filename: "valid.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      key = (
        await prisma.attachment.findUniqueOrThrow({
          where: { id: valid.body.id },
        })
      ).storageKey;
      await viewerAgent
        .get(`/api/v1/attachments/${valid.body.id}/download`)
        .set("Origin", origin)
        .set("X-Novo-Csrf", viewerSigned.body.csrfToken as string)
        .expect(403);
      const bad = (bytes: Buffer, name: string, type: string) =>
        agent
          .post("/api/v1/attachments")
          .set("Origin", origin)
          .set("X-Novo-Csrf", signed.body.csrfToken as string)
          .field("entityType", "Payment")
          .field("entityId", payment.id)
          .attach("file", bytes, { filename: name, contentType: type });
      const assertRejectedUploadHasNoResidue = async () => {
        expect(
          await prisma.attachment.count({
            where: { tenantId: account.tenantId },
          }),
        ).toBe(1);
        expect(
          await prisma.auditLog.count({
            where: {
              tenantId: account.tenantId,
              entityType: "Attachment",
              action: "upload",
            },
          }),
        ).toBe(1);
        expect(new Set(await readdir(env.UPLOAD_DIR))).toEqual(
          new Set([...beforeFiles, key]),
        );
      };
      await bad(
        Buffer.from("%PDF-1.4\nmime mismatch"),
        "mime.pdf",
        "image/png",
      ).expect(400);
      await assertRejectedUploadHasNoResidue();
      await bad(
        Buffer.from("not a document"),
        "broken.pdf",
        "application/pdf",
      ).expect(400);
      await assertRejectedUploadHasNoResidue();
      await bad(Buffer.from("%PDF"), "truncated.pdf", "application/pdf").expect(
        400,
      );
      await assertRejectedUploadHasNoResidue();
      await bad(
        Buffer.alloc(5 * 1024 * 1024 + 1, 0x41),
        "oversized.pdf",
        "application/pdf",
      ).expect(400);
      await assertRejectedUploadHasNoResidue();
    } finally {
      if (key) await rm(path.join(env.UPLOAD_DIR, key), { force: true });
    }
  });
});

async function withFixtureMovementFailure(
  tenantId: string,
  reason: string,
  suffix: string,
  callback: () => Promise<void>,
): Promise<void> {
  const fn = "novo_fail_movement_" + suffix;
  const trigger = fn + "_trigger";
  const escaped = tenantId.replace(/'/g, "''");
  await prisma.$executeRawUnsafe(
    "DROP TRIGGER IF EXISTS " + trigger + ' ON "StockMovement";',
  );
  await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS " + fn + "();");
  try {
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION " +
        fn +
        "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" +
        escaped +
        "'' AND NEW.reason = ''" +
        reason +
        "'' THEN RAISE EXCEPTION ''forced movement failure''; END IF; RETURN NEW; END;'",
    );
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER " +
        trigger +
        ' BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION ' +
        fn +
        "();",
    );
    await callback();
  } finally {
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS " + trigger + ' ON "StockMovement";',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS " + fn + "();");
  }
}

describe("Sprint 04 POS movement rollback", () => {
  it("rolls back checkout when POS_SALE movement insertion fails", async () => {
    const account = await createAccount("pos-sale-failure");
    const agent = request.agent(app);
    const signed = await login(agent, account);
    const csrf = signed.body.csrfToken as string;
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "SALEFAIL-01",
        name: "Sale Failure",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);
    await withFixtureMovementFailure(
      account.tenantId,
      "POS_SALE",
      "sale",
      async () => {
        await agent
          .post("/api/v1/sales")
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .set("Idempotency-Key", "pos-sale-fail-01")
          .send({
            paymentMethod: "CASH",
            cashReceived: 10000,
            items: [{ productId: product.body.id, quantity: 1 }],
          })
          .expect(500);
      },
    );
    expect(
      await prisma.sale.count({ where: { tenantId: account.tenantId } }),
    ).toBe(0);
    expect(
      await prisma.storePayment.count({
        where: { tenantId: account.tenantId },
      }),
    ).toBe(0);
    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, reason: "POS_SALE" },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(1);
    await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "pos-sale-success-01")
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(201);
    expect(
      await prisma.sale.count({ where: { tenantId: account.tenantId } }),
    ).toBe(1);
  });
  it("rolls back void when POS_VOID movement insertion fails", async () => {
    const account = await createAccount("pos-void-failure");
    const agent = request.agent(app);
    const signed = await login(agent, account);
    const csrf = signed.body.csrfToken as string;
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "VOIDFAIL-01",
        name: "Void Failure",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);
    const sale = await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "pos-void-sale-01")
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(201);
    await withFixtureMovementFailure(
      account.tenantId,
      "POS_VOID",
      "void",
      async () => {
        await agent
          .post("/api/v1/sales/" + sale.body.id + "/void")
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .send({ reason: "Injected movement failure" })
          .expect(500);
      },
    );
    const unchanged = await prisma.sale.findUniqueOrThrow({
      where: { id: sale.body.id },
    });
    expect(unchanged.status).toBe("COMPLETED");
    expect(unchanged.voidReason).toBeNull();
    expect(unchanged.voidedAt).toBeNull();
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(0);
    expect(
      await prisma.stockMovement.count({
        where: { saleId: sale.body.id, reason: "POS_VOID" },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: sale.body.id, action: "void" },
      }),
    ).toBe(0);
    await agent
      .post("/api/v1/sales/" + sale.body.id + "/void")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ reason: "Retry after cleanup" })
      .expect(200);
    expect(
      (await prisma.sale.findUniqueOrThrow({ where: { id: sale.body.id } }))
        .status,
    ).toBe("VOIDED");
    expect(
      await prisma.stockMovement.count({
        where: { saleId: sale.body.id, reason: "POS_VOID" },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(1);
  });
});

describe("Sprint 04 receipt movement rollback", () => {
  it("rolls back stock receipt when STOCK_RECEIPT movement insertion fails", async () => {
    const account = await createAccount("receipt-movement-failure");
    const agent = request.agent(app);
    const signed = await login(agent, account);
    const csrf = signed.body.csrfToken as string;
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "RCVFAIL-01",
        name: "Receipt Failure",
        unitPrice: 10000,
        initialStock: 2,
      })
      .expect(201);
    const baseline = {
      stock: (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
      movements: await prisma.stockMovement.count({
        where: { productId: product.body.id },
      }),
      audits: await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          action: "receive_stock",
          entityId: product.body.id,
        },
      }),
    };
    await withFixtureMovementFailure(
      account.tenantId,
      "STOCK_RECEIPT",
      "receipt",
      async () => {
        await agent
          .post("/api/v1/products/" + product.body.id + "/receipts")
          .set("Idempotency-Key", "inventory-legacy-004")
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .send({ quantity: 3, reference: "RCV-FAIL-01" })
          .expect(500);
      },
    );
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(baseline.stock);
    expect(
      await prisma.stockMovement.count({
        where: { productId: product.body.id },
      }),
    ).toBe(baseline.movements);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          action: "receive_stock",
          entityId: product.body.id,
        },
      }),
    ).toBe(baseline.audits);
    await agent
      .post("/api/v1/products/" + product.body.id + "/receipts")
      .set("Idempotency-Key", "inventory-legacy-005")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ quantity: 3, reference: "RCV-OK-01" })
      .expect(201);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(5);
    expect(
      await prisma.stockMovement.count({
        where: { productId: product.body.id, reason: "STOCK_RECEIPT" },
      }),
    ).toBe(1);
  });
});

describe("Sprint 04 receipt audit rollback", () => {
  it("rolls back stock receipt when receive_stock audit insertion fails", async () => {
    const a = await createAccount("receipt-audit-failure");
    const g = request.agent(app),
      l = await login(g, a),
      c = l.body.csrfToken as string;
    const p = await g
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", c)
      .send({
        sku: "RCVAUD-01",
        name: "Receipt Audit",
        unitPrice: 10000,
        initialStock: 2,
      })
      .expect(201);
    const base = {
      stock: (
        await prisma.product.findUniqueOrThrow({ where: { id: p.body.id } })
      ).stockOnHand,
      m: await prisma.stockMovement.count({ where: { productId: p.body.id } }),
      a: await prisma.auditLog.count({
        where: { tenantId: a.tenantId, action: "receive_stock" },
      }),
    };
    const fn = "novo_fail_receipt_audit",
      tr = fn + "_trigger";
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS " + tr + ' ON "AuditLog";',
    );
    try {
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION " +
          fn +
          "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" +
          a.tenantId.replace(/'/g, "''") +
          "'' AND NEW.action = ''receive_stock'' THEN RAISE EXCEPTION ''receipt audit failure''; END IF; RETURN NEW; END;'",
      );
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER " +
          tr +
          ' BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ' +
          fn +
          "();",
      );
      await g
        .post("/api/v1/products/" + p.body.id + "/receipts")
        .set("Idempotency-Key", "inventory-legacy-006")
        .set("Origin", origin)
        .set("X-Novo-Csrf", c)
        .send({ quantity: 3, reference: "AUD-FAIL" })
        .expect(500);
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: p.body.id } }))
          .stockOnHand,
      ).toBe(base.stock);
      expect(
        await prisma.stockMovement.count({ where: { productId: p.body.id } }),
      ).toBe(base.m);
      expect(
        await prisma.auditLog.count({
          where: { tenantId: a.tenantId, action: "receive_stock" },
        }),
      ).toBe(base.a);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS " + tr + ' ON "AuditLog";',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS " + fn + "();");
    }
    await g
      .post("/api/v1/products/" + p.body.id + "/receipts")
      .set("Idempotency-Key", "inventory-legacy-007")
      .set("Origin", origin)
      .set("X-Novo-Csrf", c)
      .send({ quantity: 3, reference: "AUD-OK" })
      .expect(201);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: p.body.id } }))
        .stockOnHand,
    ).toBe(5);
  });
});

describe("Sprint 04 adjustment movement rollback", () => {
  it("rolls back stock adjustment when StockMovement insertion fails", async () => {
    const a = await createAccount("adjustment-movement-failure"),
      g = request.agent(app),
      l = await login(g, a),
      c = l.body.csrfToken as string,
      pd = await g
        .post("/api/v1/products")
        .set("Origin", origin)
        .set("X-Novo-Csrf", c)
        .send({
          sku: "ADJFAIL-01",
          name: "Adjustment Failure",
          unitPrice: 10000,
          initialStock: 5,
        })
        .expect(201),
      reason = "CP4 adjustment fixture",
      full = "STOCK_ADJUSTMENT: " + reason,
      b = {
        s: (
          await prisma.product.findUniqueOrThrow({ where: { id: pd.body.id } })
        ).stockOnHand,
        m: await prisma.stockMovement.count({
          where: { productId: pd.body.id },
        }),
        a: await prisma.auditLog.count({
          where: { tenantId: a.tenantId, action: "adjust_stock" },
        }),
      },
      fn = "novo_fail_adjustment_movement",
      tr = fn + "_trigger";
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS " + tr + ' ON "StockMovement";',
    );
    try {
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION " +
          fn +
          "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" +
          a.tenantId.replace(/'/g, "''") +
          "'' AND NEW.reason = ''" +
          full +
          "'' THEN RAISE EXCEPTION ''adjustment failure''; END IF; RETURN NEW; END;'",
      );
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER " +
          tr +
          ' BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION ' +
          fn +
          "();",
      );
      await g
        .post("/api/v1/products/" + pd.body.id + "/adjustments")
        .set("Idempotency-Key", "inventory-legacy-008")
        .set("Origin", origin)
        .set("X-Novo-Csrf", c)
        .send({ quantity: -2, reason })
        .expect(500);
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: pd.body.id } }))
          .stockOnHand,
      ).toBe(b.s);
      expect(
        await prisma.stockMovement.count({ where: { productId: pd.body.id } }),
      ).toBe(b.m);
      expect(
        await prisma.auditLog.count({
          where: { tenantId: a.tenantId, action: "adjust_stock" },
        }),
      ).toBe(b.a);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS " + tr + ' ON "StockMovement";',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS " + fn + "();");
    }
    const ok = await g
      .post("/api/v1/products/" + pd.body.id + "/adjustments")
      .set("Idempotency-Key", "inventory-legacy-009")
      .set("Origin", origin)
      .set("X-Novo-Csrf", c)
      .send({ quantity: -2, reason })
      .expect(201);
    expect(ok.body.quantity).toBe(-2);
    expect(ok.body.balanceAfter).toBe(3);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: pd.body.id } }))
        .stockOnHand,
    ).toBe(3);
  });
});

describe("Sprint 04 adjustment audit rollback", () => {
  it("rolls back stock adjustment when adjust_stock audit insertion fails", async () => {
    const account = await createAccount("adjustment-audit-failure");
    const agent = request.agent(app);
    const loginResult = await login(agent, account);
    const csrf = loginResult.body.csrfToken as string;
    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "ADJAUD-01",
        name: "Adjustment Audit Failure",
        unitPrice: 10000,
        initialStock: 5,
      })
      .expect(201);
    const reason = "CP4 adjustment fixture";
    const movementReason = "STOCK_ADJUSTMENT: " + reason;
    const baseline = {
      stock: (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
      movements: await prisma.stockMovement.count({
        where: { productId: product.body.id },
      }),
      audits: await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          action: "adjust_stock",
          entityId: product.body.id,
        },
      }),
    };
    const functionName = "novo_fail_adjustment_audit";
    const triggerName = functionName + "_trigger";
    const tenantId = account.tenantId.replace(/'/g, "''");

    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS " + triggerName + ' ON "AuditLog";',
    );
    try {
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION " +
          functionName +
          "() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.\"tenantId\" = ''" +
          tenantId +
          "'' AND NEW.action = ''adjust_stock'' THEN RAISE EXCEPTION ''forced adjustment audit failure''; END IF; RETURN NEW; END;'",
      );
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER " +
          triggerName +
          ' BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ' +
          functionName +
          "();",
      );

      await agent
        .post("/api/v1/products/" + product.body.id + "/adjustments")
        .set("Idempotency-Key", "inventory-legacy-010")
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .send({ quantity: -2, reason })
        .expect(500);

      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: product.body.id },
          })
        ).stockOnHand,
      ).toBe(baseline.stock);
      expect(
        await prisma.stockMovement.count({
          where: { productId: product.body.id, reason: movementReason },
        }),
      ).toBe(0);
      expect(
        await prisma.stockMovement.count({
          where: { productId: product.body.id },
        }),
      ).toBe(baseline.movements);
      expect(
        await prisma.auditLog.count({
          where: {
            tenantId: account.tenantId,
            action: "adjust_stock",
            entityId: product.body.id,
          },
        }),
      ).toBe(baseline.audits);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS " + triggerName + ' ON "AuditLog";',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS " + functionName + "();",
      );
    }

    const retry = await agent
      .post("/api/v1/products/" + product.body.id + "/adjustments")
      .set("Idempotency-Key", "inventory-legacy-011")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ quantity: -2, reason })
      .expect(201);
    expect(retry.body.quantity).toBe(-2);
    expect(retry.body.balanceAfter).toBe(3);
    const persistedProduct = await prisma.product.findUniqueOrThrow({
      where: { id: product.body.id },
    });
    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.body.id, reason: movementReason },
    });
    const audits = await prisma.auditLog.findMany({
      where: {
        tenantId: account.tenantId,
        action: "adjust_stock",
        entityId: product.body.id,
      },
    });
    expect(persistedProduct.stockOnHand).toBe(3);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      tenantId: account.tenantId,
      productId: product.body.id,
      quantity: -2,
      balanceAfter: 3,
      performedById: account.userId,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tenantId: account.tenantId,
      actorId: account.userId,
      action: "adjust_stock",
      entityType: "Product",
      entityId: product.body.id,
    });
  });
});

describe("Sprint 04 product HPP authorization", () => {
  it("redacts catalog HPP for non-HPP roles while allowing permitted financial readers", async () => {
    const owner = await createAccount("product-hpp-owner");
    const other = await createAccount("product-hpp-other");
    const cashier = await createTenantUser(owner, "product-hpp-cashier");
    const analyst = await createTenantUser(owner, "product-hpp-analyst");
    const finance = await createTenantUser(owner, "product-hpp-finance");
    await prisma.user.update({
      where: { id: cashier.userId },
      data: { role: "CASHIER" },
    });
    await prisma.user.update({
      where: { id: analyst.userId },
      data: { role: "ANALYST" },
    });
    await prisma.user.update({
      where: { id: finance.userId },
      data: { role: "FINANCE_OFFICER" },
    });

    const ownerAgent = request.agent(app);
    const cashierAgent = request.agent(app);
    const analystAgent = request.agent(app);
    const financeAgent = request.agent(app);
    const otherAgent = request.agent(app);
    const ownerLogin = await login(ownerAgent, owner);
    await login(cashierAgent, cashier);
    await login(analystAgent, analyst);
    await login(financeAgent, finance);
    await login(otherAgent, other);
    const product = await ownerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerLogin.body.csrfToken as string)
      .send({
        sku: "HPPREAD-01",
        name: "HPP Read Policy",
        unitPrice: 10000,
        unitCost: 4000,
        initialStock: 3,
      })
      .expect(201);
    expect(product.body.unitCost).toBe(4000);

    const cashierCatalog = await cashierAgent
      .get("/api/v1/products")
      .expect(200);
    const cashierProduct = cashierCatalog.body.data.find(
      (item: { id: string }) => item.id === product.body.id,
    );
    expect(cashierProduct).toBeDefined();
    expect(cashierProduct).not.toHaveProperty("unitCost");
    expect(JSON.stringify(cashierProduct)).not.toContain("unitCost");

    const analystCatalog = await analystAgent
      .get("/api/v1/products")
      .expect(200);
    const analystProduct = analystCatalog.body.data.find(
      (item: { id: string }) => item.id === product.body.id,
    );
    expect(analystProduct).not.toHaveProperty("unitCost");

    const financeCatalog = await financeAgent
      .get("/api/v1/products")
      .expect(200);
    const financeProduct = financeCatalog.body.data.find(
      (item: { id: string }) => item.id === product.body.id,
    );
    expect(financeProduct.unitCost).toBe(4000);

    const otherCatalog = await otherAgent.get("/api/v1/products").expect(200);
    expect(
      otherCatalog.body.data.some(
        (item: { id: string }) => item.id === product.body.id,
      ),
    ).toBe(false);
  });

  it("rejects non-HPP manager cost writes without changing persisted HPP", async () => {
    const owner = await createAccount("product-hpp-manager-owner");
    const manager = await createTenantUser(owner, "product-hpp-manager");
    await prisma.user.update({
      where: { id: manager.userId },
      data: { role: "BUSINESS_DEVELOPMENT" },
    });
    const ownerAgent = request.agent(app);
    const managerAgent = request.agent(app);
    const ownerLogin = await login(ownerAgent, owner);
    const managerLogin = await login(managerAgent, manager);
    const ownerCsrf = ownerLogin.body.csrfToken as string;
    const managerCsrf = managerLogin.body.csrfToken as string;
    const protectedProduct = await ownerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({
        sku: "HPPMGR-01",
        name: "Protected HPP",
        unitPrice: 10000,
        unitCost: 4000,
      })
      .expect(201);

    await managerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", managerCsrf)
      .send({
        sku: "HPPMGR-02",
        name: "Rejected HPP",
        unitPrice: 10000,
        unitCost: 2500,
      })
      .expect(403);
    expect(
      await prisma.product.count({ where: { tenantId: owner.tenantId } }),
    ).toBe(1);

    const managed = await managerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", managerCsrf)
      .send({
        sku: "HPPMGR-03",
        name: "Managed Without HPP",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);
    expect(managed.body).not.toHaveProperty("unitCost");
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: managed.body.id },
        })
      ).unitCost,
    ).toBeNull();

    await managerAgent
      .post("/api/v1/products/" + protectedProduct.body.id + "/receipts")
      .set("Idempotency-Key", "inventory-legacy-012")
      .set("Origin", origin)
      .set("X-Novo-Csrf", managerCsrf)
      .send({ quantity: 1, reference: "HPP-MGR", unitCost: 2500 })
      .expect(403);
    const afterRejectedReceipt = await prisma.product.findUniqueOrThrow({
      where: { id: protectedProduct.body.id },
    });
    expect(afterRejectedReceipt.unitCost?.toString()).toBe("4000");
    expect(afterRejectedReceipt.stockOnHand).toBe(0);

    await managerAgent
      .patch("/api/v1/products/" + protectedProduct.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", managerCsrf)
      .send({ unitCost: 2500 })
      .expect(403);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: protectedProduct.body.id },
        })
      ).unitCost?.toString(),
    ).toBe("4000");

    const safePatch = await managerAgent
      .patch("/api/v1/products/" + protectedProduct.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", managerCsrf)
      .send({ name: "Managed Metadata Change" })
      .expect(200);
    expect(safePatch.body).not.toHaveProperty("unitCost");
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: protectedProduct.body.id },
        })
      ).unitCost?.toString(),
    ).toBe("4000");
  });

  it("allows a product-managing HPP role to update HPP while cashier sales and receipts stay redacted", async () => {
    const owner = await createAccount("product-hpp-authorized");
    const cashier = await createTenantUser(
      owner,
      "product-hpp-authorized-cashier",
    );
    await prisma.user.update({
      where: { id: cashier.userId },
      data: { role: "CASHIER" },
    });
    const ownerAgent = request.agent(app);
    const cashierAgent = request.agent(app);
    const ownerLogin = await login(ownerAgent, owner);
    const cashierLogin = await login(cashierAgent, cashier);
    const ownerCsrf = ownerLogin.body.csrfToken as string;
    const cashierCsrf = cashierLogin.body.csrfToken as string;
    const product = await ownerAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({
        sku: "HPPAUTH-01",
        name: "Authorized HPP",
        unitPrice: 10000,
        unitCost: 4000,
        initialStock: 2,
      })
      .expect(201);
    const updated = await ownerAgent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({ unitCost: 4500 })
      .expect(200);
    expect(updated.body.unitCost).toBe(4500);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).unitCost?.toString(),
    ).toBe("4500");
    await ownerAgent
      .post("/api/v1/products/" + product.body.id + "/receipts")
      .set("Idempotency-Key", "inventory-legacy-013")
      .set("Origin", origin)
      .set("X-Novo-Csrf", ownerCsrf)
      .send({ quantity: 1, reference: "HPP-AUTH", unitCost: 5000 })
      .expect(201);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).unitCost?.toString(),
    ).toBe("5000");

    const sale = await cashierAgent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", cashierCsrf)
      .set("Idempotency-Key", "hpp-authorized-sale-01")
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(201);
    expect(JSON.stringify(sale.body)).not.toContain("unitCost");
    expect(JSON.stringify(sale.body)).not.toContain("grossMargin");
    const receipt = await cashierAgent
      .get("/api/v1/sales/" + sale.body.id + "/receipt")
      .expect(200);
    expect(JSON.stringify(receipt.body)).not.toContain("unitCost");
    expect(JSON.stringify(receipt.body)).not.toContain("grossMargin");
  });
});

describe("Sprint 04 SKU database integrity", () => {
  it("canonicalizes API SKU creates and updates, rejects conflicts without partial writes, and preserves sale snapshots", async () => {
    const account = await createAccount("sku-api-integrity");
    const agent = request.agent(app);
    const loginResult = await login(agent, account);
    const csrf = loginResult.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "abc-001",
        name: "Canonical API SKU",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);
    expect(product.body.sku).toBe("ABC-001");

    await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ sku: "ABC-001", name: "Conflicting API SKU", unitPrice: 10000 })
      .expect(409);
    expect(
      await prisma.product.count({ where: { tenantId: account.tenantId } }),
    ).toBe(1);

    const second = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "second-003",
        name: "Second Canonical SKU",
        unitPrice: 10000,
      })
      .expect(201);
    expect(second.body.sku).toBe("SECOND-003");
    await agent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ sku: "second-003" })
      .expect(409);
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).sku,
    ).toBe("ABC-001");

    const sale = await agent
      .post("/api/v1/sales")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "sku-integrity-sale-01")
      .send({
        paymentMethod: "CASH",
        cashReceived: 10000,
        items: [{ productId: product.body.id, quantity: 1 }],
      })
      .expect(201);

    await agent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ sku: "next-002" })
      .expect(200)
      .then((response) => expect(response.body.sku).toBe("NEXT-002"));
    await agent
      .patch("/api/v1/products/" + product.body.id)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ sku: "not a valid sku" })
      .expect(400);

    const persisted = await prisma.product.findUniqueOrThrow({
      where: { id: product.body.id },
    });
    const snapshot = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: sale.body.id },
    });
    expect(persisted.sku).toBe("NEXT-002");
    expect(snapshot.productSku).toBe("ABC-001");
  });

  it("enforces canonical SKU integrity on direct PostgreSQL writes while permitting the same SKU in another tenant", async () => {
    const account = await createAccount("sku-direct-integrity");
    const other = await createAccount("sku-direct-integrity-other");
    const agent = request.agent(app);
    const otherAgent = request.agent(app);
    const loginResult = await login(agent, account);
    const otherLogin = await login(otherAgent, other);
    const csrf = loginResult.body.csrfToken as string;
    const otherCsrf = otherLogin.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "db-case-001",
        name: "Database Canonical SKU",
        unitPrice: 10000,
      })
      .expect(201);
    expect(product.body.sku).toBe("DB-CASE-001");

    const now = new Date();
    await expect(prisma.$executeRaw`
      INSERT INTO "Product" ("id", "tenantId", "sku", "name", "unitPrice", "stockOnHand", "reorderLevel", "active", "createdAt", "updatedAt")
      VALUES (${"sku-direct-lowercase"}, ${account.tenantId}, ${"db-case-001"}, ${"Direct lowercase bypass"}, ${new Prisma.Decimal(10000)}, ${0}, ${0}, ${true}, ${now}, ${now})
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      INSERT INTO "Product" ("id", "tenantId", "sku", "name", "unitPrice", "stockOnHand", "reorderLevel", "active", "createdAt", "updatedAt")
      VALUES (${"sku-direct-duplicate"}, ${account.tenantId}, ${"DB-CASE-001"}, ${"Direct duplicate bypass"}, ${new Prisma.Decimal(10000)}, ${0}, ${0}, ${true}, ${now}, ${now})
    `).rejects.toThrow();
    expect(
      await prisma.product.count({
        where: { tenantId: account.tenantId, sku: "DB-CASE-001" },
      }),
    ).toBe(1);

    const otherProduct = await otherAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", otherCsrf)
      .send({ sku: "db-case-001", name: "Other Tenant SKU", unitPrice: 15000 })
      .expect(201);
    expect(otherProduct.body.sku).toBe("DB-CASE-001");
    expect(await prisma.product.count({ where: { sku: "DB-CASE-001" } })).toBe(
      2,
    );
  });
});

describe("Sprint 04 Inventory idempotency regression", () => {
  it("replays identical receipts once and redacts internal fields", async () => {
    const account = await createAccount("inventory-idem-receipt");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "IDEM-RC-001",
        name: "Idempotent Receipt Product",
        unitPrice: 10000,
        initialStock: 5,
      })
      .expect(201);

    const path = "/api/v1/products/" + product.body.id + "/receipts";
    const key = "inventory-idem-receipt-001";
    const payload = { quantity: 3, reference: "IDEM-DOC-001" };

    const first = await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);

    const replay = await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(200);

    expect(replay.body).toEqual(first.body);
    expect(first.body).not.toHaveProperty("idempotencyKey");
    expect(first.body).not.toHaveProperty("inputFingerprint");

    await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send({ ...payload, quantity: 4 })
      .expect(409);

    await agent
      .post("/api/v1/products/" + product.body.id + "/adjustments")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send({ quantity: -1, reason: "Cross-operation key" })
      .expect(409);

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(8);

    expect(
      await prisma.stockMovement.count({
        where: {
          tenantId: account.tenantId,
          productId: product.body.id,
          reason: "STOCK_RECEIPT",
        },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityId: product.body.id,
          action: "receive_stock",
        },
      }),
    ).toBe(1);

    const history = await agent
      .get("/api/v1/products/" + product.body.id + "/movements")
      .expect(200);

    expect(history.body.data.length).toBeGreaterThan(0);

    for (const movement of history.body.data) {
      expect(movement).not.toHaveProperty("idempotencyKey");
      expect(movement).not.toHaveProperty("inputFingerprint");
    }
  }, 30_000);

  it("replays adjustments without reducing stock twice", async () => {
    const account = await createAccount("inventory-idem-adjustment");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "IDEM-AD-001",
        name: "Idempotent Adjustment Product",
        unitPrice: 10000,
        initialStock: 8,
      })
      .expect(201);

    const path = "/api/v1/products/" + product.body.id + "/adjustments";
    const key = "inventory-idem-adjustment-001";
    const payload = {
      quantity: -3,
      reason: "Physical inventory recount",
      reference: "IDEM-COUNT-001",
    };

    const first = await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);

    const replay = await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(200);

    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body).not.toHaveProperty("idempotencyKey");
    expect(replay.body).not.toHaveProperty("inputFingerprint");

    await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send({ ...payload, reason: "Damaged goods" })
      .expect(409);

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(5);

    expect(
      await prisma.stockMovement.count({
        where: {
          tenantId: account.tenantId,
          productId: product.body.id,
          reason: "STOCK_ADJUSTMENT: " + payload.reason,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityId: product.body.id,
          action: "adjust_stock",
        },
      }),
    ).toBe(1);
  }, 30_000);

  it("isolates inventory idempotency keys between tenants", async () => {
    const firstAccount = await createAccount("inventory-idem-tenant-one");
    const secondAccount = await createAccount("inventory-idem-tenant-two");

    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);

    const firstLogin = await login(firstAgent, firstAccount);
    const secondLogin = await login(secondAgent, secondAccount);

    const firstCsrf = firstLogin.body.csrfToken as string;
    const secondCsrf = secondLogin.body.csrfToken as string;

    const firstProduct = await firstAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", firstCsrf)
      .send({
        sku: "IDEM-TEN-001",
        name: "First Tenant Product",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);

    const secondProduct = await secondAgent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", secondCsrf)
      .send({
        sku: "IDEM-TEN-001",
        name: "Second Tenant Product",
        unitPrice: 10000,
        initialStock: 1,
      })
      .expect(201);

    const key = "inventory-idem-shared-tenant-001";
    const payload = { quantity: 2, reference: "SHARED-REF-001" };

    const first = await firstAgent
      .post("/api/v1/products/" + firstProduct.body.id + "/receipts")
      .set("Origin", origin)
      .set("X-Novo-Csrf", firstCsrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);

    const second = await secondAgent
      .post("/api/v1/products/" + secondProduct.body.id + "/receipts")
      .set("Origin", origin)
      .set("X-Novo-Csrf", secondCsrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);

    expect(first.body.id).not.toBe(second.body.id);

    for (const productId of [firstProduct.body.id, secondProduct.body.id]) {
      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: productId },
          })
        ).stockOnHand,
      ).toBe(3);
    }

    expect(
      await prisma.stockMovement.count({
        where: {
          tenantId: firstAccount.tenantId,
          idempotencyKey: key,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.stockMovement.count({
        where: {
          tenantId: secondAccount.tenantId,
          idempotencyKey: key,
        },
      }),
    ).toBe(1);
  }, 30_000);

  it("does not duplicate stock under concurrent identical requests", async () => {
    const account = await createAccount("inventory-idem-concurrent");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "IDEM-CON-001",
        name: "Concurrent Receipt Product",
        unitPrice: 10000,
        initialStock: 4,
      })
      .expect(201);

    const path = "/api/v1/products/" + product.body.id + "/receipts";
    const key = "inventory-idem-concurrent-001";
    const payload = { quantity: 3, reference: "CONCURRENT-REF-001" };

    const attempts = await Promise.all([
      agent
        .post(path)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .set("Idempotency-Key", key)
        .send(payload),
      agent
        .post(path)
        .set("Origin", origin)
        .set("X-Novo-Csrf", csrf)
        .set("Idempotency-Key", key)
        .send(payload),
    ]);

    expect(attempts.some((result) => result.status === 201)).toBe(true);
    expect(
      attempts.every((result) => [200, 201, 409].includes(result.status)),
    ).toBe(true);

    const replay = await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(200);

    expect(replay.body).not.toHaveProperty("idempotencyKey");

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(7);

    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, idempotencyKey: key },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: account.tenantId,
          entityId: product.body.id,
          action: "receive_stock",
        },
      }),
    ).toBe(1);
  }, 30_000);

  it("allows retrying the same key after receipt rollback", async () => {
    const account = await createAccount("inventory-idem-receipt-rollback");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "IDEM-RBK-001",
        name: "Receipt Rollback Product",
        unitPrice: 10000,
        initialStock: 2,
      })
      .expect(201);

    const path = "/api/v1/products/" + product.body.id + "/receipts";
    const key = "inventory-idem-receipt-rollback-001";
    const payload = { quantity: 2, reference: "RBK-RECEIPT-001" };

    await withFixtureMovementFailure(
      account.tenantId,
      "STOCK_RECEIPT",
      "idemreceipt",
      async () => {
        await agent
          .post(path)
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .set("Idempotency-Key", key)
          .send(payload)
          .expect(500);
      },
    );

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(2);

    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, idempotencyKey: key },
      }),
    ).toBe(0);

    await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);

    await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(200);

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(4);

    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, idempotencyKey: key },
      }),
    ).toBe(1);
  }, 30_000);

  it("allows retrying the same key after adjustment rollback", async () => {
    const account = await createAccount("inventory-idem-adjustment-rollback");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "IDEM-ARB-001",
        name: "Adjustment Rollback Product",
        unitPrice: 10000,
        initialStock: 5,
      })
      .expect(201);

    const path = "/api/v1/products/" + product.body.id + "/adjustments";
    const key = "inventory-idem-adjustment-rollback-001";
    const payload = {
      quantity: -2,
      reason: "Physical inventory correction",
      reference: "RBK-ADJUSTMENT-001",
    };

    await withFixtureMovementFailure(
      account.tenantId,
      "STOCK_ADJUSTMENT: " + payload.reason,
      "idemadjustment",
      async () => {
        await agent
          .post(path)
          .set("Origin", origin)
          .set("X-Novo-Csrf", csrf)
          .set("Idempotency-Key", key)
          .send(payload)
          .expect(500);
      },
    );

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(5);

    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, idempotencyKey: key },
      }),
    ).toBe(0);

    await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);

    await agent
      .post(path)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(200);

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(3);

    expect(
      await prisma.stockMovement.count({
        where: { tenantId: account.tenantId, idempotencyKey: key },
      }),
    ).toBe(1);
  }, 30_000);

  it("rejects missing and malformed inventory idempotency keys", async () => {
    const account = await createAccount("inventory-idem-validation");
    const agent = request.agent(app);
    const signedIn = await login(agent, account);
    const csrf = signedIn.body.csrfToken as string;

    const product = await agent
      .post("/api/v1/products")
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        sku: "IDEM-VAL-001",
        name: "Inventory Key Validation Product",
        unitPrice: 10000,
        initialStock: 3,
      })
      .expect(201);

    const receiptPath = "/api/v1/products/" + product.body.id + "/receipts";
    const adjustmentPath =
      "/api/v1/products/" + product.body.id + "/adjustments";

    await agent
      .post(receiptPath)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({ quantity: 2 })
      .expect(400);

    await agent
      .post(receiptPath)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .set("Idempotency-Key", "short")
      .send({ quantity: 2 })
      .expect(400);

    await agent
      .post(adjustmentPath)
      .set("Origin", origin)
      .set("X-Novo-Csrf", csrf)
      .send({
        quantity: -1,
        reason: "Validation test",
      })
      .expect(400);

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: product.body.id },
        })
      ).stockOnHand,
    ).toBe(3);

    expect(
      await prisma.stockMovement.count({
        where: {
          tenantId: account.tenantId,
          reason: "STOCK_RECEIPT",
        },
      }),
    ).toBe(0);
  }, 30_000);
});

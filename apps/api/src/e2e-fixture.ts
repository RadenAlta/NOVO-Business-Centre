import bcrypt from "bcryptjs";

import { prisma } from "./db.js";

type E2eFixture = {
  tenantId: string;
  tenantSlug: string;
  email: string;
  password: string;
  viewerEmail: string;
  viewerPassword: string;
  routeName: string;
  subscriptionRiderName: string;
};

type ActivityClassificationState = {
  classificationAuditCount: number;
  classificationAuditAfter: unknown[];
  aiInteractionCount: number;
  invoiceCount: number;
  shuttleSettlementCount: number;
  stockMovementCount: number;
};

type CashierE2eFixture = E2eFixture & {
  cleanupTenantIds: string[];
  cashierEmail: string;
  cashierPassword: string;
  financeEmail: string;
  financePassword: string;
  invoiceId: string;
  invoiceNo: string;
  foreignInvoiceId: string;
  foreignInvoiceNo: string;
};

function assertDisposableE2eDatabase(): void {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("E2E fixture requires a PostgreSQL DATABASE_URL.");
  }
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (
    process.env.NODE_ENV !== "test"
    || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.port !== "55433"
    || databaseName !== "novo_test"
  ) {
    throw new Error("E2E fixture requires NODE_ENV=test and local disposable PostgreSQL novo_test on port 55433.");
  }
}

function fixtureId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createFixture(): Promise<E2eFixture> {
  assertDisposableE2eDatabase();
  const suffix = fixtureId();
  const tenantSlug = `e2e-${suffix}`.slice(0, 50);
  const email = `owner-${suffix}@example.test`;
  const password = "SyntheticE2ePass123!";
  const viewerEmail = `viewer-${suffix}@example.test`;
  const viewerPassword = "SyntheticViewerPass123!";
  const routeName = `Rute E2E ${suffix}`;
  const subscriptionRiderName = `Siswa E2E ${suffix}`;
  const passwordHash = await bcrypt.hash(password, 4);

  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant E2E ${suffix}`,
      slug: tenantSlug,
      users: {
        create: [
          {
            name: "Owner E2E Sintetis",
            email,
            passwordHash,
            role: "SUPER_ADMIN",
          },
          {
            name: "Viewer E2E Sintetis",
            email: viewerEmail,
            passwordHash: await bcrypt.hash(viewerPassword, 4),
            role: "VIEWER",
          },
        ],
      },
    },
    include: { users: { select: { id: true, email: true } } },
  });
  const owner = tenant.users.find((user) => user.email === email);
  if (!owner) throw new Error("Synthetic E2E owner was not created.");

  const route = await prisma.shuttleRoute.create({
    data: {
      tenantId: tenant.id,
      code: `E2E-${suffix.slice(-6).toUpperCase()}`,
      name: routeName,
      stops: ["Terminal Sintetis", "Sekolah Sintetis"],
      monthlyRate: 100_000,
    },
  });
  const rider = await prisma.masterDataRecord.create({
    data: {
      tenantId: tenant.id,
      type: "STUDENT",
      identifier: `E2E-STUDENT-${suffix}`,
      fullName: subscriptionRiderName,
    },
  });
  await prisma.shuttleSubscription.create({
    data: {
      tenantId: tenant.id,
      routeId: route.id,
      studentIdentityId: rider.id,
      startDate: new Date("2026-11-01T00:00:00.000Z"),
    },
  });
  return {
    tenantId: tenant.id,
    tenantSlug,
    email,
    password,
    viewerEmail,
    viewerPassword,
    routeName,
    subscriptionRiderName,
  };
}

async function getActivityClassificationState(tenantId: string): Promise<ActivityClassificationState> {
  assertDisposableE2eDatabase();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  if (!tenant?.slug.startsWith("e2e-")) {
    throw new Error("F4 state inspection accepts only an e2e fixture tenant.");
  }

  const [audits, aiInteractionCount, invoiceCount, shuttleSettlementCount, stockMovementCount] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId, action: "suggest_activity_category" },
      select: { after: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.aiInteraction.count({ where: { tenantId } }),
    prisma.invoice.count({ where: { tenantId } }),
    prisma.shuttleSettlement.count({ where: { tenantId } }),
    prisma.stockMovement.count({ where: { tenantId } }),
  ]);

  return {
    classificationAuditCount: audits.length,
    classificationAuditAfter: audits.map((audit) => audit.after),
    aiInteractionCount,
    invoiceCount,
    shuttleSettlementCount,
    stockMovementCount,
  };
}

async function createCashierFixture(): Promise<CashierE2eFixture> {
  const base = await createFixture();
  const owner = await prisma.user.findFirstOrThrow({
    where: { tenantId: base.tenantId, email: base.email },
    select: { id: true },
  });
  const subscription = await prisma.shuttleSubscription.findFirstOrThrow({
    where: { tenantId: base.tenantId },
    select: { id: true, routeId: true },
  });
  const suffix = fixtureId();
  const cashierPassword = "SyntheticCashierPass123!";
  const financePassword = "SyntheticFinancePass123!";
  const [cashier, finance, route] = await Promise.all([
    prisma.user.create({
      data: {
        tenantId: base.tenantId,
        name: "Cashier E2E Sintetis",
        email: `cashier-${suffix}@example.test`,
        passwordHash: await bcrypt.hash(cashierPassword, 4),
        role: "CASHIER",
      },
    }),
    prisma.user.create({
      data: {
        tenantId: base.tenantId,
        name: "Finance E2E Sintetis",
        email: `finance-${suffix}@example.test`,
        passwordHash: await bcrypt.hash(financePassword, 4),
        role: "FINANCE_OFFICER",
      },
    }),
    prisma.shuttleRoute.findUniqueOrThrow({ where: { id: subscription.routeId } }),
  ]);
  const startsAt = new Date("2026-11-01T00:00:00.000Z");
  const endsAt = new Date("2026-12-01T00:00:00.000Z");
  const finalizedAt = new Date("2026-11-01T08:00:00.000Z");
  const period = await prisma.shuttleBillingPeriod.create({
    data: {
      tenantId: base.tenantId,
      startsAt,
      endsAt,
      status: "FINALIZED",
      finalizedAt,
      finalizedById: owner.id,
    },
  });
  const invoiceNo = `E2E-CASH-${suffix}`.toUpperCase();
  const invoice = await prisma.invoice.create({
    data: {
      tenantId: base.tenantId,
      subscriptionId: subscription.id,
      shuttleBillingPeriodId: period.id,
      invoiceNo,
      description: "Synthetic Cashier E2E invoice",
      amount: 100_000,
      status: "ISSUED",
      dueDate: new Date("2026-11-15T00:00:00.000Z"),
      issuedAt: finalizedAt,
      finalizedAt,
      finalizedById: owner.id,
      routeCodeSnapshot: route.code,
      routeNameSnapshot: route.name,
      rateSnapshot: 100_000,
      proratedDays: 30,
      periodDays: 30,
    },
  });
  const foreignTenant = await prisma.tenant.create({
    data: { name: `Foreign E2E ${suffix}`, slug: `e2e-foreign-${suffix}`.slice(0, 50) },
  });
  const foreignInvoiceNo = `E2E-FOREIGN-${suffix}`.toUpperCase();
  const foreignInvoice = await prisma.invoice.create({
    data: {
      tenantId: foreignTenant.id,
      invoiceNo: foreignInvoiceNo,
      description: "Foreign synthetic invoice",
      amount: 100_000,
      status: "ISSUED",
      issuedAt: finalizedAt,
    },
  });
  return {
    ...base,
    cleanupTenantIds: [base.tenantId, foreignTenant.id],
    cashierEmail: cashier.email,
    cashierPassword,
    financeEmail: finance.email,
    financePassword,
    invoiceId: invoice.id,
    invoiceNo,
    foreignInvoiceId: foreignInvoice.id,
    foreignInvoiceNo,
  };
}

async function cleanupFixture(tenantIds: string[]): Promise<void> {
  assertDisposableE2eDatabase();
  const requestedTenantIds = [...new Set(tenantIds)];
  if (!requestedTenantIds.every((tenantId) => /^[a-z0-9]{20,40}$/.test(tenantId))) {
    throw new Error("E2E cleanup accepts only generated tenant identifiers.");
  }

  await prisma.$transaction(async (transaction) => {
    const tenants = await transaction.tenant.findMany({
      where: { id: { in: requestedTenantIds } },
      select: { id: true, slug: true },
    });
    const nonE2eTenant = tenants.find((tenant) => !tenant.slug.startsWith("e2e-"));
    if (nonE2eTenant) {
      throw new Error("E2E cleanup refuses a tenant that is not an e2e fixture.");
    }
    const verifiedTenantIds = tenants.map((tenant) => tenant.id);
    if (!verifiedTenantIds.length) return;

    // ShuttleSettlementPayment.paymentId is ON DELETE RESTRICT. Both relation
    // filters are required: an invalid cross-tenant junction can never cause a
    // fixture cleanup to delete another tenant's allocation.
    await transaction.shuttleSettlementPayment.deleteMany({
      where: {
        settlement: { tenantId: { in: verifiedTenantIds } },
        payment: { tenantId: { in: verifiedTenantIds } },
      },
    });

    // The remaining tenant-owned records retain the schema's existing cascade
    // behavior. Missing requested fixtures make this operation idempotent.
    await transaction.tenant.deleteMany({
      where: {
        id: { in: verifiedTenantIds },
        slug: { startsWith: "e2e-" },
      },
    });
  });
}

async function main(): Promise<void> {
  const [command, ...values] = process.argv.slice(2);
  if (command === "create") {
    process.stdout.write(JSON.stringify(await createFixture()));
    return;
  }
  if (command === "create-cashier") {
    process.stdout.write(JSON.stringify(await createCashierFixture()));
    return;
  }
  if (command === "cleanup" && values.length) {
    await cleanupFixture(values);
    return;
  }
  if (command === "f4-state" && values.length === 1) {
    process.stdout.write(JSON.stringify(await getActivityClassificationState(values[0] ?? "")));
    return;
  }
  throw new Error("Usage: e2e-fixture.ts create | create-cashier | f4-state <tenant-id> | cleanup <tenant-id...>");
}

main()
  .catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? `${error.message}\n` : "E2E fixture failed.\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

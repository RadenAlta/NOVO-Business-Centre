import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-novo" },
    update: { name: "NOVO Demo Cooperative" },
    create: { name: "NOVO Demo Cooperative", slug: "demo-novo" },
  });
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  const owner = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "owner@demo.novo.local" } },
    update: { passwordHash, active: true, role: "SUPER_ADMIN", name: "NOVO Owner" },
    create: { tenantId: tenant.id, email: "owner@demo.novo.local", name: "NOVO Owner", passwordHash, role: "SUPER_ADMIN" },
  });
  const identity = await prisma.masterDataRecord.upsert({
    where: { tenantId_type_identifier: { tenantId: tenant.id, type: "EMPLOYEE", identifier: "EMP-DEMO-001" } },
    update: { fullName: "Ayu Demonstrasi", department: "Operasional", active: true, dataSource: "SYNTHETIC_SEED" },
    create: { tenantId: tenant.id, type: "EMPLOYEE", identifier: "EMP-DEMO-001", fullName: "Ayu Demonstrasi", department: "Operasional", email: "ayu@example.invalid", phone: "081234567890", dataSource: "SYNTHETIC_SEED" },
  });
  const member = await prisma.cooperativeMember.upsert({
    where: { tenantId_memberNo: { tenantId: tenant.id, memberNo: "ANG-001" } },
    update: { identityId: identity.id, name: identity.fullName, email: identity.email, phone: identity.phone, active: true },
    create: { tenantId: tenant.id, identityId: identity.id, memberNo: "ANG-001", name: identity.fullName, email: identity.email, phone: identity.phone },
  });  const product = await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: tenant.id, sku: "NOVO-SNACK-01" } },
    update: { name: "Snack Box Demo", unitPrice: 15000, reorderLevel: 5, active: true },
    create: { tenantId: tenant.id, sku: "NOVO-SNACK-01", name: "Snack Box Demo", unitPrice: 15000, reorderLevel: 5 },
  });
  const initialStock = await prisma.stockMovement.findFirst({ where: { tenantId: tenant.id, productId: product.id, reference: "SEED-STOCK-01" } });
  if (!initialStock) await prisma.stockMovement.create({ data: { tenantId: tenant.id, productId: product.id, quantity: 30, reason: "SEED_STOCK", reference: "SEED-STOCK-01" } });
  const route = await prisma.shuttleRoute.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "SHT-UTARA" } },
    update: { name: "Rute Utara", monthlyRate: 350000, active: true },
    create: { tenantId: tenant.id, code: "SHT-UTARA", name: "Rute Utara", stops: ["Gerbang Utama", "Kompleks Utara", "Sekolah"], monthlyRate: 350000 },
  });
  const subscription = await prisma.shuttleSubscription.findFirst({ where: { tenantId: tenant.id, memberId: member.id, routeId: route.id, status: "ACTIVE" } })
    ?? await prisma.shuttleSubscription.create({ data: { tenantId: tenant.id, memberId: member.id, routeId: route.id, startDate: new Date() } });
  const account = await prisma.savingsAccount.upsert({
    where: { tenantId_memberId: { tenantId: tenant.id, memberId: member.id } },
    update: {},
    create: { tenantId: tenant.id, memberId: member.id, accountNo: "SAV-SEED-001" },
  });
  await prisma.savingsLedgerEntry.upsert({
    where: { accountId_reference: { accountId: account.id, reference: "SEED-OPENING" } },
    update: {},
    create: { accountId: account.id, direction: "CREDIT", amount: 100000, reference: "SEED-OPENING", description: "Synthetic opening balance for local development" },
  });
  await prisma.knowledgeDocument.upsert({
    where: { id: `${tenant.id}-about` },
    update: { content: "NOVO mengelola toko, shuttle, katering, simpanan, dan pembiayaan koperasi. Untuk pembayaran tagihan, gunakan nomor referensi dan hubungi petugas keuangan jika ada ketidaksesuaian." },
    create: { id: `${tenant.id}-about`, tenantId: tenant.id, title: "Panduan layanan NOVO", content: "NOVO mengelola toko, shuttle, katering, simpanan, dan pembiayaan koperasi. Untuk pembayaran tagihan, gunakan nomor referensi dan hubungi petugas keuangan jika ada ketidaksesuaian.", source: "Synthetic local demo content" },
  });
  await prisma.auditLog.create({ data: { tenantId: tenant.id, actorId: owner.id, action: "seed", entityType: "Tenant", entityId: tenant.id, after: { memberId: member.id, subscriptionId: subscription.id } } });
  console.log("Seeded demo workspace: demo-novo / owner@demo.novo.local / ChangeMe123!");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

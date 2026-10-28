import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(currentDirectory, "..");
const repositoryDirectory = resolve(apiDirectory, "..", "..");
const migrationName = "202610280006_store_sku_integrity";
const precedingMigrationNames = [
  "202610240001_init",
  "202610250002_server_sessions",
  "202610250003_stable_csrf_token",
  "202610260004_master_data_import_preview",
  "202610270005_store_pos_hardening",
];
const fixtureDatabases = [
  "novo_sku_migration_valid",
  "novo_sku_migration_invalid",
  "novo_sku_migration_collision",
  "novo_sku_migration_cross_tenant",
  "novo_sku_migration_concurrency",
];

function assertDisposableSourceDatabase() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Legacy SKU migration tests require NODE_ENV=test.");
  }

  const sourceUrl = new URL(process.env.DATABASE_URL ?? "");
  const databaseName = decodeURIComponent(sourceUrl.pathname.slice(1));
  if (!/^(novo_ci|novo_test)$/.test(databaseName)) {
    throw new Error(
      `Legacy SKU migration tests only run from novo_ci or novo_test, received ${databaseName || "<missing>"}.`,
    );
  }
  return sourceUrl;
}

function urlForDatabase(sourceUrl, databaseName) {
  const fixtureUrl = new URL(sourceUrl);
  fixtureUrl.pathname = `/${databaseName}`;
  return fixtureUrl.toString();
}

function adminUrlFor(sourceUrl) {
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  return adminUrl.toString();
}

function shellCommand() {
  return "pnpm";
}

function runPrisma(args, { databaseUrl, stdin } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pnpmArguments = ["--filter", "@novo/api", "exec", "prisma", ...args];
    const useWindowsCommandShell = process.platform === "win32";
    const processResult = spawn(
      useWindowsCommandShell ? "cmd.exe" : shellCommand(),
      useWindowsCommandShell
        ? ["/d", "/s", "/c", [shellCommand(), ...pnpmArguments].join(" ")]
        : pnpmArguments,
      {
        cwd: repositoryDirectory,
        env: {
          ...process.env,
          NODE_ENV: "test",
          ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    processResult.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    processResult.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    processResult.once("error", rejectPromise);
    processResult.once("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const error = new Error(`prisma ${args.join(" ")} exited ${code}: ${stderr || stdout}`);
      error.stdout = stdout;
      error.stderr = stderr;
      rejectPromise(error);
    });
    processResult.stdin.end(stdin ?? "");
  });
}

function sql(databaseUrl, statement) {
  return runPrisma(["db", "execute", "--stdin"], {
    databaseUrl,
    stdin: statement,
  });
}

async function expectFailure(action, pattern, message) {
  try {
    await action();
  } catch (error) {
    const details = `${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    if (!pattern.test(details)) {
      throw new Error(`${message}. Unexpected error: ${details}`);
    }
    return;
  }
  throw new Error(`${message}. The operation unexpectedly succeeded.`);
}

async function assertSql(databaseUrl, assertion, message) {
  await expectFailure(
    () => sql(databaseUrl, `DO $assert$ BEGIN IF NOT (${assertion}) THEN RAISE EXCEPTION 'assertion failed'; END IF; END $assert$;`),
    /assertion failed/,
    message,
  ).catch((error) => {
    if (error.message.includes("unexpectedly succeeded")) {
      return;
    }
    throw error;
  });
}

async function requireSql(databaseUrl, assertion, message) {
  try {
    await sql(databaseUrl, `DO $assert$ BEGIN IF NOT (${assertion}) THEN RAISE EXCEPTION 'assertion failed: ${message.replace(/'/g, "''")}'; END IF; END $assert$;`);
  } catch (error) {
    throw new Error(`${message}: ${error.message}`);
  }
}

async function createFixtureDatabase(adminUrl, databaseName) {
  await sql(
    adminUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS "${databaseName}";`,
  );
  await sql(adminUrl, `CREATE DATABASE "${databaseName}";`);
}

async function dropFixtureDatabase(adminUrl, databaseName) {
  await sql(
    adminUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS "${databaseName}";`,
  );
}

async function createPreSkuSchema() {
  const temporaryPrismaDirectory = await mkdtemp(join(tmpdir(), "novo-sku-migration-"));
  const schema = await readFile(join(currentDirectory, "schema.prisma"), "utf8");
  await writeFile(join(temporaryPrismaDirectory, "schema.prisma"), schema);
  await cp(
    join(currentDirectory, "migrations", "migration_lock.toml"),
    join(temporaryPrismaDirectory, "migrations", "migration_lock.toml"),
  );
  await Promise.all(
    precedingMigrationNames.map((name) =>
      cp(join(currentDirectory, "migrations", name), join(temporaryPrismaDirectory, "migrations", name), { recursive: true }),
    ),
  );
  return temporaryPrismaDirectory;
}

async function applyPreSkuMigrations(databaseUrl, schemaDirectory) {
  await runPrisma(["migrate", "deploy", "--schema", join(schemaDirectory, "schema.prisma")], { databaseUrl });
}

async function applyCurrentMigration(databaseUrl) {
  await runPrisma(["migrate", "deploy", "--schema", join(currentDirectory, "schema.prisma")], { databaseUrl });
}

function seedSql({ tenantId = "tenant-a", productId = "product-a", sku, secondProduct, includeHistory = false }) {
  const products = [
    `('${productId}', '${tenantId}', '${sku}', 'Legacy product', 10000, 7, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ...(secondProduct
      ? [`('${secondProduct.id}', '${secondProduct.tenantId ?? tenantId}', '${secondProduct.sku}', 'Second legacy product', 15000, 2, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`]
      : []),
  ];
  const history = includeHistory
    ? `
INSERT INTO "StockMovement" ("id", "tenantId", "productId", "quantity", "reason", "balanceAfter", "performedById")
VALUES ('movement-a', '${tenantId}', '${productId}', 7, 'SEED', 7, 'user-a');
INSERT INTO "Sale" ("id", "tenantId", "cashierId", "receiptNo", "status", "paymentMethod", "total")
VALUES ('sale-a', '${tenantId}', 'user-a', 'RECEIPT-001', 'COMPLETED', 'CASH', 10000);
INSERT INTO "SaleItem" ("id", "saleId", "productId", "productSku", "productName", "quantity", "unitPrice", "subtotal")
VALUES ('sale-item-a', 'sale-a', '${productId}', '${sku}', 'Legacy product', 1, 10000, 10000);`
    : "";
  return `
INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES ('${tenantId}', 'Fixture ${tenantId}', '${tenantId}', CURRENT_TIMESTAMP);
${secondProduct?.tenantId && secondProduct.tenantId !== tenantId ? `INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES ('${secondProduct.tenantId}', 'Fixture ${secondProduct.tenantId}', '${secondProduct.tenantId}', CURRENT_TIMESTAMP);` : ""}
INSERT INTO "User" ("id", "tenantId", "email", "name", "passwordHash", "role", "updatedAt") VALUES ('user-a', '${tenantId}', 'fixture@example.test', 'Fixture User', 'not-a-secret', 'OWNER', CURRENT_TIMESTAMP);
INSERT INTO "Product" ("id", "tenantId", "sku", "name", "unitPrice", "stockOnHand", "reorderLevel", "active", "createdAt", "updatedAt") VALUES ${products.join(",")};
${history}`;
}

async function withFixture(sourceUrl, schemaDirectory, databaseName, seed, test) {
  const adminUrl = adminUrlFor(sourceUrl);
  const databaseUrl = urlForDatabase(sourceUrl, databaseName);
  await createFixtureDatabase(adminUrl, databaseName);
  try {
    await applyPreSkuMigrations(databaseUrl, schemaDirectory);
    await sql(databaseUrl, seed);
    await test(databaseUrl);
  } finally {
    await dropFixtureDatabase(adminUrl, databaseName);
  }
}

async function waitForProductLock(databaseUrl) {
  const assertion = `EXISTS (
    SELECT 1
    FROM pg_locks AS lock
    WHERE lock.relation = '"Product"'::regclass
      AND lock.mode = 'ShareRowExclusiveLock'
      AND lock.granted
  )`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await requireSql(databaseUrl, assertion, "migration is still acquiring its Product write lock");
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error("The SKU migration never acquired ShareRowExclusiveLock on Product.");
}

async function main() {
  const sourceUrl = assertDisposableSourceDatabase();
  const schemaDirectory = await createPreSkuSchema();
  try {
    await withFixture(
      sourceUrl,
      schemaDirectory,
      "novo_sku_migration_valid",
      seedSql({ sku: "abc-001", includeHistory: true }),
      async (databaseUrl) => {
        await applyCurrentMigration(databaseUrl);
        await requireSql(databaseUrl, `
          (SELECT "sku" = 'ABC-001' AND "stockOnHand" = 7 FROM "Product" WHERE "id" = 'product-a')
          AND (SELECT "productId" = 'product-a' AND "balanceAfter" = 7 FROM "StockMovement" WHERE "id" = 'movement-a')
          AND (SELECT "productSku" = 'abc-001' FROM "SaleItem" WHERE "id" = 'sale-item-a')
          AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sku_canonical_ascii_check')
        `, "valid legacy SKU migration preserves product references and historical snapshots");
        await expectFailure(
          () => sql(databaseUrl, `UPDATE "Product" SET "sku" = 'abc-001' WHERE "id" = 'product-a';`),
          /Product_sku_canonical_ascii_check|check constraint/i,
          "canonical CHECK rejects direct lowercase write after migration",
        );
      },
    );

    await withFixture(
      sourceUrl,
      schemaDirectory,
      "novo_sku_migration_invalid",
      seedSql({ sku: "legacy sku" }),
      async (databaseUrl) => {
        await expectFailure(
          () => applyCurrentMigration(databaseUrl),
          /SKU integrity preflight failed: invalid legacy SKU/i,
          "invalid legacy SKU must fail migration preflight",
        );
        await requireSql(databaseUrl, `
          (SELECT "sku" = 'legacy sku' FROM "Product" WHERE "id" = 'product-a')
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sku_canonical_ascii_check')
          AND EXISTS (
            SELECT 1 FROM "_prisma_migrations"
            WHERE migration_name = '${migrationName}' AND finished_at IS NULL AND rolled_back_at IS NULL
          )
        `, "invalid preflight leaves legacy data and constraint state unchanged while Prisma records failure");
        await sql(databaseUrl, `UPDATE "Product" SET "sku" = 'ABC-001' WHERE "id" = 'product-a';`);
        await runPrisma(["migrate", "resolve", "--rolled-back", migrationName, "--schema", join(currentDirectory, "schema.prisma")], { databaseUrl });
        await applyCurrentMigration(databaseUrl);
        await requireSql(databaseUrl, `EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sku_canonical_ascii_check')`, "resolved migration can be retried only after the operator reconciles data");
      },
    );

    await withFixture(
      sourceUrl,
      schemaDirectory,
      "novo_sku_migration_collision",
      seedSql({
        sku: "abc-001",
        secondProduct: { id: "product-b", sku: "ABC-001" },
      }),
      async (databaseUrl) => {
        await expectFailure(
          () => applyCurrentMigration(databaseUrl),
          /normalized SKU collisions require manual reconciliation/i,
          "same-tenant normalized SKU collision must fail migration preflight",
        );
        await requireSql(databaseUrl, `
          (SELECT count(*) = 2 FROM "Product" WHERE "tenantId" = 'tenant-a' AND "sku" IN ('abc-001', 'ABC-001'))
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sku_canonical_ascii_check')
        `, "collision preflight does not rewrite, delete, suffix, or choose a legacy SKU winner");
      },
    );

    await withFixture(
      sourceUrl,
      schemaDirectory,
      "novo_sku_migration_cross_tenant",
      seedSql({
        sku: "abc-001",
        secondProduct: { id: "product-b", tenantId: "tenant-b", sku: "abc-001" },
      }),
      async (databaseUrl) => {
        await applyCurrentMigration(databaseUrl);
        await requireSql(databaseUrl, `
          (SELECT count(*) = 2 FROM "Product" WHERE "sku" = 'ABC-001')
          AND (SELECT count(DISTINCT "tenantId") = 2 FROM "Product" WHERE "sku" = 'ABC-001')
        `, "same canonical SKU remains valid across tenants");
      },
    );

    await withFixture(
      sourceUrl,
      schemaDirectory,
      "novo_sku_migration_concurrency",
      seedSql({ sku: "abc-001", tenantId: "tenant-race", productId: "product-race" }),
      async (databaseUrl) => {
        await sql(databaseUrl, `
          CREATE FUNCTION "novo_sku_pause_update"() RETURNS trigger LANGUAGE plpgsql AS $pause$
          BEGIN
            IF NEW."sku" = 'ABC-001' THEN
              PERFORM pg_sleep(1.5);
            END IF;
            RETURN NEW;
          END;
          $pause$;
          CREATE TRIGGER "novo_sku_pause_update_trigger"
          BEFORE UPDATE OF "sku" ON "Product"
          FOR EACH ROW EXECUTE FUNCTION "novo_sku_pause_update"();
        `);
        try {
          const migration = applyCurrentMigration(databaseUrl);
          await waitForProductLock(databaseUrl);
          let writerSettled = false;
          const writer = sql(databaseUrl, `
            INSERT INTO "Product" ("id", "tenantId", "sku", "name", "unitPrice", "stockOnHand", "reorderLevel", "active", "createdAt", "updatedAt")
            VALUES ('product-race-writer', 'tenant-race', 'race-002', 'Racing writer', 10000, 0, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          `).finally(() => {
            writerSettled = true;
          });
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
          if (writerSettled) {
            throw new Error("direct Product writer was not blocked by the SKU migration lock");
          }
          await migration;
          await expectFailure(
            () => writer,
            /Product_sku_canonical_ascii_check|check constraint/i,
            "blocked lowercase writer must be rejected after the canonical constraint commits",
          );
          await requireSql(databaseUrl, `
            (SELECT "sku" = 'ABC-001' FROM "Product" WHERE "id" = 'product-race')
            AND NOT EXISTS (SELECT 1 FROM "Product" WHERE "id" = 'product-race-writer')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sku_canonical_ascii_check')
          `, "migration lock prevents a lower-case direct write from crossing the preflight/constraint interval");
        } finally {
          await sql(databaseUrl, `DROP TRIGGER IF EXISTS "novo_sku_pause_update_trigger" ON "Product"; DROP FUNCTION IF EXISTS "novo_sku_pause_update"();`);
        }
      },
    );
  } finally {
    await rm(schemaDirectory, { recursive: true, force: true });
  }
  console.log("Legacy Store SKU migration safety checks passed.");
}

await main();

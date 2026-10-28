import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

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
const concurrencyBarrierKey = 748217511;

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
  return runPrisma(["db", "execute", "--schema", join(currentDirectory, "schema.prisma"), "--stdin"], {
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

async function requireSql(databaseUrl, assertion, message) {
  try {
    await sql(databaseUrl, `DO $assert$ BEGIN IF NOT (${assertion}) THEN RAISE EXCEPTION 'assertion failed: ${message.replace(/'/g, "''")}'; END IF; END $assert$;`);
  } catch (error) {
    throw new Error(`${message}: ${error.message}`);
  }
}

function assertFixtureDatabaseName(databaseName) {
  if (!fixtureDatabases.includes(databaseName)) {
    throw new Error(`Refusing to modify unexpected database: ${databaseName}`);
  }
}

async function terminateAndDropFixtureDatabase(adminUrl, databaseName) {
  assertFixtureDatabaseName(databaseName);

  await sql(
    adminUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();`,
  );

  await sql(adminUrl, `DROP DATABASE IF EXISTS "${databaseName}";`);
}

async function createFixtureDatabase(adminUrl, databaseName) {
  assertFixtureDatabaseName(databaseName);
  await terminateAndDropFixtureDatabase(adminUrl, databaseName);
  await sql(adminUrl, `CREATE DATABASE "${databaseName}";`);
}

async function dropFixtureDatabase(adminUrl, databaseName) {
  assertFixtureDatabaseName(databaseName);
  await terminateAndDropFixtureDatabase(adminUrl, databaseName);
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

function fixturePrismaClient(databaseUrl) {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function currentDatabaseLockRows(client, expectedDatabaseName) {
  const currentDatabase = await client.$queryRawUnsafe("SELECT current_database() AS name");
  if (currentDatabase.length !== 1 || currentDatabase[0].name !== expectedDatabaseName) {
    throw new Error(`Lock monitor is connected to ${currentDatabase[0]?.name ?? "<unknown>"}, not ${expectedDatabaseName}.`);
  }
  return client.$queryRawUnsafe(`
    SELECT lock.pid, lock.mode, lock.granted, lock.database, database.datname
    FROM pg_locks AS lock
    INNER JOIN pg_database AS database ON database.oid = lock.database
    WHERE lock.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND lock.relation = '"Product"'::regclass
  `);
}

async function waitForLock(client, expectedDatabaseName, predicate, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const locks = await currentDatabaseLockRows(client, expectedDatabaseName);
    const matchingLock = locks.find(predicate);
    if (matchingLock) {
      return matchingLock;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description} on the fixture Product relation.`);
}

function isCancellationError(error) {
  return /canceling statement due to user request|query was canceled/i.test(
    `${error?.message ?? ""}\n${error?.code ?? ""}\n${error?.meta?.message ?? ""}`,
  );
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
        await requireSql(databaseUrl, `
          EXISTS (
            SELECT 1 FROM "Product"
            WHERE "id" = 'product-a'
              AND "sku" = 'legacy sku'
              AND NOT (
                UPPER("sku") ~ '^[A-Z0-9][A-Z0-9._/-]{1,49}$'
                AND octet_length("sku") = char_length("sku")
              )
          )
        `, "invalid legacy fixture must violate canonical SKU format");
        await expectFailure(
          () => applyCurrentMigration(databaseUrl),
          /(?:SKU integrity preflight failed: invalid legacy SKU|current transaction is aborted)/i,
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
        await requireSql(databaseUrl, `
          (SELECT COUNT(*) = 2
           FROM "Product"
           WHERE "tenantId" = 'tenant-a'
             AND UPPER("sku") = 'ABC-001')
        `, "collision fixture must contain two canonical-equivalent SKUs");
        await expectFailure(
          () => applyCurrentMigration(databaseUrl),
          /(?:normalized SKU collisions require manual reconciliation|current transaction is aborted)/i,
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
        const fixtureDatabaseName = "novo_sku_migration_concurrency";
        const monitor = fixturePrismaClient(databaseUrl);
        const barrierClient = fixturePrismaClient(databaseUrl);
        const writerClient = fixturePrismaClient(databaseUrl);
        let releaseBarrier;
        let barrierOutcome;
        let migrationOutcome;
        let writerOutcome;
        let migrationPid;
        let writerPid;
        let writerFinished = false;
        await sql(databaseUrl, `
          CREATE FUNCTION "novo_sku_pause_update"() RETURNS trigger LANGUAGE plpgsql AS $pause$
          BEGIN
            IF NEW."sku" = 'ABC-001' THEN
              PERFORM pg_advisory_xact_lock(${concurrencyBarrierKey});
            END IF;
            RETURN NEW;
          END;
          $pause$;
          CREATE TRIGGER "novo_sku_pause_update_trigger"
          BEFORE UPDATE OF "sku" ON "Product"
          FOR EACH ROW EXECUTE FUNCTION "novo_sku_pause_update"();
        `);
        let primaryFailure;
        try {
          await Promise.all([monitor.$connect(), barrierClient.$connect(), writerClient.$connect()]);

          let markBarrierReady;
          let failBarrierReady;
          const barrierReady = new Promise((resolveBarrier, rejectBarrier) => {
            markBarrierReady = resolveBarrier;
            failBarrierReady = rejectBarrier;
          });
          const barrierRelease = new Promise((resolveBarrierRelease) => {
            releaseBarrier = resolveBarrierRelease;
          });
          barrierOutcome = barrierClient
            .$transaction(
              async (transaction) => {
                const backend = await transaction.$queryRawUnsafe("SELECT pg_backend_pid() AS pid");
                await transaction.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${concurrencyBarrierKey})`);
                markBarrierReady(backend[0]?.pid);
                await barrierRelease;
              },
              { maxWait: 5_000, timeout: 15_000 },
            )
            .then(() => ({ ok: true }), (error) => {
              failBarrierReady(error);
              return { ok: false, error };
            });
          await barrierReady;

          migrationOutcome = applyCurrentMigration(databaseUrl).then(
            () => ({ ok: true }),
            (error) => ({ ok: false, error }),
          );
          const migrationLock = await waitForLock(
            monitor,
            fixtureDatabaseName,
            (lock) => lock.mode === "ShareRowExclusiveLock" && lock.granted === true,
            "a granted ShareRowExclusiveLock held by the migration",
          );
          migrationPid = Number(migrationLock.pid);
          if (!Number.isInteger(migrationPid) || migrationPid <= 0) {
            throw new Error(`Migration lock has an invalid backend PID: ${migrationLock.pid}`);
          }

          writerOutcome = writerClient.$executeRawUnsafe(`
            INSERT INTO "Product" ("id", "tenantId", "sku", "name", "unitPrice", "stockOnHand", "reorderLevel", "active", "createdAt", "updatedAt")
            VALUES ('product-race-writer', 'tenant-race', 'race-002', 'Racing writer', 10000, 0, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          `).then(
            () => ({ ok: true }),
            (error) => ({ ok: false, error }),
          ).then((result) => {
            writerFinished = true;
            return result;
          });
          const pendingWriterLock = await waitForLock(
            monitor,
            fixtureDatabaseName,
            (lock) => lock.mode === "RowExclusiveLock" && lock.granted === false && Number(lock.pid) !== migrationPid,
            "a pending RowExclusiveLock held by the direct writer",
          );
          writerPid = Number(pendingWriterLock.pid);
          if (!Number.isInteger(writerPid) || writerPid <= 0) {
            throw new Error(`Pending writer lock has an invalid backend PID: ${pendingWriterLock.pid}`);
          }
          if (writerFinished) {
            throw new Error("Writer completed despite a pending RowExclusiveLock observation.");
          }
          const cancellation = await monitor.$queryRawUnsafe(
            "SELECT pg_cancel_backend($1::integer) AS cancelled",
            writerPid,
          );
          if (cancellation.length !== 1 || cancellation[0].cancelled !== true) {
            throw new Error(`PostgreSQL did not cancel blocked writer backend ${writerPid}.`);
          }
          const canceledWriter = await writerOutcome;
          if (canceledWriter.ok || !isCancellationError(canceledWriter.error)) {
            throw new Error(`Blocked writer did not fail from explicit cancellation: ${canceledWriter.error?.message ?? "completed successfully"}`);
          }

          releaseBarrier();
          releaseBarrier = undefined;
          const releasedBarrier = await barrierOutcome;
          if (!releasedBarrier.ok) {
            throw releasedBarrier.error;
          }
          const completedMigration = await migrationOutcome;
          if (!completedMigration.ok) {
            throw completedMigration.error;
          }

          await expectFailure(
            () => writerClient.$executeRawUnsafe(`
              INSERT INTO "Product" ("id", "tenantId", "sku", "name", "unitPrice", "stockOnHand", "reorderLevel", "active", "createdAt", "updatedAt")
              VALUES ('product-race-lowercase', 'tenant-race', 'race-003', 'Lowercase after migration', 10000, 0, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            `),
            /Product_sku_canonical_ascii_check|check constraint/i,
            "fresh lowercase writer is rejected by the committed canonical CHECK",
          );
          await requireSql(databaseUrl, `
            (SELECT "sku" = 'ABC-001' FROM "Product" WHERE "id" = 'product-race')
            AND NOT EXISTS (SELECT 1 FROM "Product" WHERE "id" = 'product-race-writer')
            AND NOT EXISTS (SELECT 1 FROM "Product" WHERE "id" = 'product-race-lowercase')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sku_canonical_ascii_check')
          `, "migration lock prevents a lower-case direct write from crossing the preflight/constraint interval and the committed CHECK rejects fresh lowercase writes");
        } catch (error) {
          primaryFailure = error;
        } finally {
          const cleanupFailures = [];
          if (writerOutcome && writerPid) {
            try {
              const settledWriter = await Promise.race([writerOutcome, delay(0).then(() => undefined)]);
              if (!settledWriter) {
                const locks = await currentDatabaseLockRows(monitor, fixtureDatabaseName);
                const pendingWriter = locks.find((lock) => lock.mode === "RowExclusiveLock" && lock.granted === false && Number(lock.pid) === writerPid);
                if (pendingWriter) {
                  await monitor.$queryRawUnsafe("SELECT pg_cancel_backend($1::integer)", writerPid);
                }
              }
            } catch (error) {
              cleanupFailures.push(error);
            }
          }
          if (releaseBarrier) {
            releaseBarrier();
          }
          await Promise.allSettled([barrierOutcome, migrationOutcome, writerOutcome].filter(Boolean));
          try {
            await sql(databaseUrl, `DROP TRIGGER IF EXISTS "novo_sku_pause_update_trigger" ON "Product"; DROP FUNCTION IF EXISTS "novo_sku_pause_update"();`);
          } catch (error) {
            cleanupFailures.push(error);
          } finally {
            const disconnects = await Promise.allSettled([monitor.$disconnect(), barrierClient.$disconnect(), writerClient.$disconnect()]);
            cleanupFailures.push(...disconnects.filter((result) => result.status === "rejected").map((result) => result.reason));
          }
          if (cleanupFailures.length) {
            throw new AggregateError(
              primaryFailure
                ? [primaryFailure, ...cleanupFailures]
                : cleanupFailures,
              "Legacy SKU concurrency test or cleanup failed.",
            );
          }
          if (primaryFailure) {
            throw primaryFailure;
          }
        }
      },
    );
  } finally {
    await rm(schemaDirectory, { recursive: true, force: true });
  }
  console.log("Legacy Store SKU migration safety checks passed.");
}

await main();

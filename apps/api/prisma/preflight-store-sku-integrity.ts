import { prisma } from "../src/db.js";

type InvalidSku = {
  tenantId: string;
  productId: string;
  sku: string | null;
  normalizedSku: string | null;
};

type SkuCollision = {
  tenantId: string;
  normalizedSku: string;
  products: Array<{ productId: string; sku: string }>;
};

export async function collectStoreSkuPreflightReport(): Promise<{
  normalization: string;
  invalidRows: InvalidSku[];
  collisions: SkuCollision[];
}> {
  const invalidRows = await prisma.$queryRaw<InvalidSku[]>`
    SELECT
      "tenantId",
      "id" AS "productId",
      "sku",
      CASE WHEN "sku" IS NULL THEN NULL ELSE upper(btrim("sku")) END AS "normalizedSku"
    FROM "Product"
    WHERE "sku" IS NULL
      OR "sku" !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$'
      OR octet_length("sku") <> char_length("sku")
    ORDER BY "tenantId", "id"
  `;

  const collisions = await prisma.$queryRaw<SkuCollision[]>`
    SELECT
      "tenantId",
      upper(btrim("sku")) AS "normalizedSku",
      jsonb_agg(
        jsonb_build_object('productId', "id", 'sku', "sku")
        ORDER BY "id"
      ) AS products
    FROM "Product"
    WHERE "sku" IS NOT NULL
      AND "sku" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$'
    GROUP BY "tenantId", upper(btrim("sku"))
    HAVING COUNT(*) > 1
    ORDER BY "tenantId", "normalizedSku"
  `;

  return {
    normalization: "ASCII SKU ([A-Za-z0-9][A-Za-z0-9._/-]{1,49}) stored as uppercase; PostgreSQL upper(btrim(sku)) is used only to report legacy collisions.",
    invalidRows,
    collisions,
  };
}

async function main(): Promise<void> {
  const report = await collectStoreSkuPreflightReport();
  console.log(JSON.stringify(report, null, 2));
  if (report.invalidRows.length || report.collisions.length) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
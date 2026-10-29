import { prisma } from "../db.js";
import { purgeExpiredImportPreviews } from "../import-preview-retention.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("Retention purge requires DATABASE_URL.");
  }

  try {
    const deletedCount = await purgeExpiredImportPreviews();

    process.stdout.write(
      JSON.stringify({
        event: "import_preview_retention_purge",
        deletedCount,
      }) + "\n",
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("Import preview retention purge failed.");
  process.exitCode = 1;
});
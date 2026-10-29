import { prisma } from "./db.js";

export async function purgeExpiredImportPreviews(
  cutoff: Date = new Date(),
): Promise<number> {
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error("Invalid preview retention cutoff.");
  }

  const result = await prisma.masterDataImportPreview.deleteMany({
    where: {
      expiresAt: { lte: cutoff },
    },
  });

  return result.count;
}
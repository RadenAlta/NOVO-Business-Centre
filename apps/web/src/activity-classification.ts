import { ApiError } from "./api";
import { hasRole } from "./shuttle-ui";

export const activityCategories = [
  "INVENTORY",
  "SALES",
  "SERVICE",
  "ADMINISTRATION",
] as const;

export type ActivityCategory = (typeof activityCategories)[number];

export type ActivityClassification = {
  predictedCategory: ActivityCategory;
  confidence?: number;
  decisionScore?: number;
  modelVersion: string;
  labelVersion: string;
  inferenceStatus: "SUCCESS";
};

// This mirrors the server's requireRoles("OWNER", "ADMIN", "ANALYST")
// through the existing delegated-role helper. The API remains authoritative.
export const activityClassificationRoles = ["OWNER", "ADMIN", "ANALYST"] as const;

export function canUseActivityClassification(role: string): boolean {
  return hasRole(role, activityClassificationRoles);
}

export function manualActivityDraft(category: ActivityCategory): {
  category: ActivityCategory;
  source: "MANUAL_DRAFT";
  persisted: false;
} {
  return { category, source: "MANUAL_DRAFT", persisted: false };
}

export function activityClassificationErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return "Akses untuk meminta saran kategori ditolak.";
    if (cause.code === "ML_SERVICE_TIMEOUT" || cause.code === "ML_SERVICE_UNAVAILABLE" || cause.code === "ML_SERVICE_INVALID_RESPONSE") {
      return "Saran AI sementara tidak tersedia. Pilih kategori secara manual; pilihan ini belum disimpan.";
    }
    if (cause.status === 400) return "Catatan harus berisi 3–500 karakter bermakna tanpa data pribadi.";
  }
  return "Saran kategori tidak dapat diproses. Pilih kategori secara manual; pilihan ini belum disimpan.";
}

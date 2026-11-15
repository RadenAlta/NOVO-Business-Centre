import { ApiError } from "./api";

export const shuttleOpsRoles = [
  "OWNER",
  "ADMIN",
  "SUPER_ADMIN",
  "ADMIN_STAFF",
  "FLEET_MANAGER",
] as const;
export const shuttleRouteWriteRoles = [
  "OWNER",
  "ADMIN",
  "FLEET_MANAGER",
] as const;
export const shuttleFinanceRoles = [
  "OWNER",
  "ADMIN",
  "SUPER_ADMIN",
  "TREASURER",
] as const;
export const shuttleInvoiceReadRoles = [
  "OWNER",
  "ADMIN",
  "FLEET_MANAGER",
  "FINANCE_OFFICER",
] as const;
export const shuttlePaymentRecordRoles = [
  "OWNER",
  "ADMIN",
  "FINANCE_OFFICER",
  "CASHIER",
] as const;
export const attachmentWriteRoles = [
  "OWNER",
  "ADMIN",
  "CASHIER",
  "FLEET_MANAGER",
  "CATERING_MANAGER",
  "FINANCE_OFFICER",
  "PROCUREMENT_OFFICER",
] as const;
const paymentProofTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const delegatedRoles: Readonly<Record<string, readonly string[]>> = {
  SUPER_ADMIN: [
    "OWNER",
    "ADMIN",
    "CASHIER",
    "FLEET_MANAGER",
    "CATERING_MANAGER",
    "FINANCE_OFFICER",
    "PROCUREMENT_OFFICER",
    "ANALYST",
    "VIEWER",
    "SUPER_ADMIN",
    "CHAIRMAN",
    "TREASURER",
    "BUSINESS_DEVELOPMENT",
    "ADMIN_STAFF",
    "AUDITOR",
  ],
  CHAIRMAN: [
    "OWNER",
    "ADMIN",
    "FLEET_MANAGER",
    "CATERING_MANAGER",
    "FINANCE_OFFICER",
    "PROCUREMENT_OFFICER",
    "ANALYST",
  ],
  TREASURER: ["FINANCE_OFFICER", "ANALYST"],
  BUSINESS_DEVELOPMENT: [
    "FLEET_MANAGER",
    "CATERING_MANAGER",
    "PROCUREMENT_OFFICER",
    "ANALYST",
  ],
  ADMIN_STAFF: [
    "ADMIN",
    "FLEET_MANAGER",
    "CATERING_MANAGER",
    "PROCUREMENT_OFFICER",
    "ANALYST",
  ],
  AUDITOR: ["ANALYST"],
};

export function hasRole(role: string, roles: readonly string[]): boolean {
  return (
    roles.includes(role) ||
    (delegatedRoles[role] ?? []).some((delegatedRole) =>
      roles.includes(delegatedRole),
    )
  );
}

export function isProtectedResourceQueryKey(
  queryKey: readonly unknown[],
  resource: string,
): boolean {
  return (
    queryKey[0] === "novo-protected" &&
    typeof queryKey[1] === "string" &&
    (queryKey[1] === resource || queryKey[1].startsWith(`${resource}:`))
  );
}

export function invoiceOutstanding(
  amount: number,
  payments: { amount: number; status: string }[],
): number {
  const verified = payments
    .filter((payment) => payment.status === "VERIFIED")
    .reduce((total, payment) => total + Number(payment.amount), 0);
  return Math.max(0, Number(amount) - verified);
}

export function shuttleErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError))
    return "Layanan Shuttle tidak dapat diproses. Coba lagi.";
  if (cause.status === 403)
    return "Akses ditolak. Peran akun ini tidak diizinkan melakukan tindakan tersebut.";
  if (cause.status === 404)
    return "Data Shuttle tidak ditemukan atau bukan milik workspace ini.";
  if (cause.status === 409)
    return `Data berubah atau statusnya tidak lagi valid${cause.code ? ` (${cause.code})` : ""}. Muat ulang data lalu coba kembali.`;
  if (cause.status >= 500)
    return "Layanan gagal memproses transaksi. Tidak ada status berhasil yang ditampilkan; periksa kembali riwayat setelah memuat ulang.";
  return cause.message;
}

export function localDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

export function paymentProofPreflight(file: {
  type: string;
  size: number;
}): string | undefined {
  if (!paymentProofTypes.has(file.type))
    return "Pilih PDF, JPEG, PNG, atau WEBP. Server tetap akan memeriksa signature berkas.";
  if (file.size > 5 * 1024 * 1024)
    return "Ukuran bukti pembayaran maksimal 5 MiB.";
  return undefined;
}

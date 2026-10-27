import { api } from "./api";

export type ImportSummary = { create: number; update: number; skip: number; error: number };
export type ImportIssue = { row: number; field: string; message: string };
export type ImportPreview = {
  previewId: string;
  fingerprint: string;
  expiresAt: string;
  summary: ImportSummary;
  rows: Array<{ row: number; type?: string; identifier?: string; fullName?: string; action: "create" | "update" | "skip" | "error"; reason?: string }>;
  issues: ImportIssue[];
};

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export function makeImportPreviewForm(file: File): FormData {
  const body = new FormData();
  body.append("file", file, file.name);
  return body;
}

export function canCommitImport(preview: ImportPreview | null): boolean {
  return Boolean(preview && preview.summary.error === 0 && preview.summary.create + preview.summary.update > 0);
}

export function membershipEligibilityMessage(identity: { type: string; active: boolean } | null | undefined): string {
  if (!identity) return "Pilih identitas guru atau pegawai dari tenant ini.";
  if (identity.type === "STUDENT") return "Siswa tidak dapat menjadi anggota koperasi.";
  if (!identity.active) return "Identitas nonaktif tidak dapat menjadi anggota koperasi.";
  return "Identitas memenuhi syarat keanggotaan.";
}

export async function previewMasterDataImport(file: File, request: ApiRequest = api): Promise<ImportPreview> {
  return request<ImportPreview>("/master-data/imports/preview", { method: "POST", body: makeImportPreviewForm(file) });
}

export async function commitMasterDataImport(preview: ImportPreview, request: ApiRequest = api): Promise<{ summary: ImportSummary }> {
  return request<{ summary: ImportSummary }>("/master-data/imports/commit", { method: "POST", body: JSON.stringify({ previewId: preview.previewId, fingerprint: preview.fingerprint }) });
}
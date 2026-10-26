import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import { ApiError, api, downloadApiFile, type Session } from "./api";
import { canCommitImport, commitMasterDataImport, membershipEligibilityMessage, previewMasterDataImport, type ImportPreview } from "./master-data-import";
import { protectedQueryKey, protectedQueryPrefix } from "./session-cache";

type IdentityType = "STUDENT" | "TEACHER" | "EMPLOYEE";
type MasterDataRecord = {
  id: string;
  type: IdentityType;
  identifier: string;
  fullName: string;
  barcode?: string | null;
  className?: string | null;
  grade?: string | null;
  schoolYear?: string | null;
  department?: string | null;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  active: boolean;
  dataSource: string;
};
type Pagination = { page: number; pageSize: number; total: number; pageCount: number };
type Paged<T> = { data: T[]; pagination: Pagination };
type Member = {
  id: string;
  memberNo: string;
  name: string;
  active: boolean;
  eligible: boolean;
  identity: { id: string; type: IdentityType; identifier: string; fullName: string; active: boolean } | null;
};
type FormState = {
  type: IdentityType;
  identifier: string;
  fullName: string;
  barcode: string;
  className: string;
  grade: string;
  schoolYear: string;
  department: string;
  position: string;
  email: string;
  phone: string;
};

const blankForm: FormState = { type: "STUDENT", identifier: "", fullName: "", barcode: "", className: "", grade: "", schoolYear: "", department: "", position: "", email: "", phone: "" };
const formatError = (cause: unknown) => cause instanceof ApiError ? cause.message : "Layanan tidak dapat diproses. Coba lagi.";

function ProtectedQuery<T>({ resource, path, session, children }: { resource: string; path: string; session: Session; children: (query: UseQueryResult<T, Error>) => ReactNode }) {
  const query = useQuery({ queryKey: protectedQueryKey(resource, session, path), queryFn: ({ signal }) => api<T>(path, { signal }) });
  return <>{children(query)}</>;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
function Message({ children }: { children: ReactNode }) { return <p className="form-message" role="status">{children}</p>; }
function QueryState({ loading, error, empty, children }: { loading: boolean; error: unknown; empty: boolean; children: ReactNode }) {
  if (loading) return <Card><p className="muted">Memuat data…</p></Card>;
  if (error) return <Card><p className="error" role="alert">{formatError(error)}</p></Card>;
  if (empty) return <Card><p className="empty">Tidak ada data yang sesuai.</p></Card>;
  return <>{children}</>;
}

function toForm(record: MasterDataRecord): FormState {
  return {
    type: record.type,
    identifier: record.identifier,
    fullName: record.fullName,
    barcode: record.barcode ?? "",
    className: record.className ?? "",
    grade: record.grade ?? "",
    schoolYear: record.schoolYear ?? "",
    department: record.department ?? "",
    position: record.position ?? "",
    email: record.email ?? "",
    phone: record.phone ?? "",
  };
}

function formPayload(form: FormState) {
  const optional = (value: string) => value.trim() || null;
  const common = { type: form.type, identifier: form.identifier, fullName: form.fullName, barcode: optional(form.barcode), email: optional(form.email), phone: optional(form.phone) };
  return form.type === "STUDENT"
    ? { ...common, className: optional(form.className), grade: optional(form.grade), schoolYear: optional(form.schoolYear) }
    : { ...common, department: optional(form.department), position: optional(form.position) };
}

export function MasterDataPage({ session }: { session: Session }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | IdentityType>("ALL");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "true" | "false">("ALL");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editing, setEditing] = useState<MasterDataRecord | null>(null);
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [memberIdentityId, setMemberIdentityId] = useState("");
  const [memberNo, setMemberNo] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const masterPath = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (search.trim()) params.set("q", search.trim());
    if (typeFilter !== "ALL") params.set("type", typeFilter);
    if (activeFilter !== "ALL") params.set("active", activeFilter);
    return `/master-data?${params.toString()}`;
  }, [activeFilter, page, search, typeFilter]);
  const membersPath = useMemo(() => `/members?${new URLSearchParams({ page: "1", pageSize: "50", ...(memberSearch.trim() ? { q: memberSearch.trim() } : {}) }).toString()}`, [memberSearch]);

  const saveIdentity = useMutation({
    mutationFn: (payload: ReturnType<typeof formPayload>) => editing ? api<MasterDataRecord>(`/master-data/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) }) : api<MasterDataRecord>("/master-data", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (record) => {
      setNotice(editing ? `Perubahan ${record.fullName} tersimpan.` : `Identitas ${record.fullName} tersimpan.`);
      setEditing(null);
      setForm(blankForm);
      void client.invalidateQueries({ queryKey: protectedQueryPrefix("master-data") });
    },
    onError: (cause) => setNotice(formatError(cause)),
  });
  const changeStatus = useMutation({
    mutationFn: ({ record, active }: { record: MasterDataRecord; active: boolean }) => api<void>(`/master-data/${record.id}/active`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => { setNotice("Status identitas diperbarui."); void client.invalidateQueries({ queryKey: protectedQueryPrefix("master-data") }); void client.invalidateQueries({ queryKey: protectedQueryPrefix("members") }); },
    onError: (cause) => setNotice(formatError(cause)),
  });
  const previewImport = useMutation({
    mutationFn: (selectedFile: File) => previewMasterDataImport(selectedFile),
    onSuccess: (next) => { setPreview(next); setNotice(`Preview siap: ${next.summary.create} buat, ${next.summary.update} perbarui, ${next.summary.skip} lewati, ${next.summary.error} error.`); },
    onError: (cause) => { setPreview(null); setNotice(formatError(cause)); },
  });
  const commitImport = useMutation({
    mutationFn: (currentPreview: ImportPreview) => commitMasterDataImport(currentPreview),
    onSuccess: (result) => { setNotice(`Import selesai: ${result.summary.create} dibuat, ${result.summary.update} diperbarui, ${result.summary.skip} dilewati.`); setPreview(null); setFile(null); void client.invalidateQueries({ queryKey: protectedQueryPrefix("master-data") }); void client.invalidateQueries({ queryKey: protectedQueryPrefix("members") }); },
    onError: (cause) => setNotice(formatError(cause)),
  });
  const createMember = useMutation({
    mutationFn: () => api<Member>("/members", { method: "POST", body: JSON.stringify({ identityId: memberIdentityId, memberNo }) }),
    onSuccess: (member) => { setNotice(`Anggota koperasi ${member.name} dibuat.`); setMemberIdentityId(""); setMemberNo(""); void client.invalidateQueries({ queryKey: protectedQueryPrefix("members") }); },
    onError: (cause) => setNotice(formatError(cause)),
  });

  const downloadTemplate = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const blob = await downloadApiFile("/master-data/imports/template");
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "novo-master-data-template.xlsx";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setDownloadError(formatError(cause));
    } finally {
      setDownloading(false);
    }
  };

  return <section className="page">
    <header className="page-header"><div><p className="eyebrow">Data operasional</p><h1>Master Data & keanggotaan</h1><p>Kelola identitas sintetis secara tenant-scoped. Import Excel selalu melalui preview dan konfirmasi eksplisit.</p></div></header>
    {notice && <Message>{notice}</Message>}
    <div className="grid-two wide-left">
      <Card>
        <div className="card-heading"><div><h2>Direktori identitas</h2><p>Gunakan pencarian, filter, dan halaman berikutnya agar daftar besar tidak terpotong diam-diam.</p></div></div>
        <div className="inline-form"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Cari nama, identifier, atau barcode"/><select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value as "ALL" | IdentityType); setPage(1); }}><option value="ALL">Semua jenis</option><option value="STUDENT">Siswa</option><option value="TEACHER">Guru</option><option value="EMPLOYEE">Pegawai</option></select><select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value as "ALL" | "true" | "false"); setPage(1); }}><option value="ALL">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></div>
        <ProtectedQuery<Paged<MasterDataRecord>> resource="master-data" path={masterPath} session={session}>{(records) => <QueryState loading={records.isLoading} error={records.error} empty={!records.data?.data.length}><div className="list">{records.data?.data.map((record) => <div className="list-row" key={record.id}><div><strong>{record.fullName}</strong><small>{record.type} · {record.identifier}{record.department ? ` · ${record.department}` : record.className ? ` · ${record.className}` : ""} · {record.dataSource}</small></div><div><span className={`status ${record.active ? "" : "danger-badge"}`}>{record.active ? "AKTIF" : "NONAKTIF"}</span><button className="text-button" onClick={() => { setEditing(record); setForm(toForm(record)); }}>Edit</button><button className="text-button" disabled={changeStatus.isPending} onClick={() => changeStatus.mutate({ record, active: !record.active })}>{record.active ? "Nonaktifkan" : "Aktifkan"}</button></div></div>)}</div><div className="form-pair"><button className="secondary" disabled={(records.data?.pagination.page ?? 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Sebelumnya</button><button className="secondary" disabled={(records.data?.pagination.page ?? 1) >= (records.data?.pagination.pageCount ?? 1)} onClick={() => setPage((current) => current + 1)}>Berikutnya</button></div><p className="muted">{records.data?.pagination.total ?? 0} identitas · halaman {records.data?.pagination.page ?? 1} dari {records.data?.pagination.pageCount ?? 1}</p></QueryState>}</ProtectedQuery>
      </Card>
      <Card><h2>{editing ? "Edit identitas" : "Tambah identitas"}</h2><form className="stack-form" onSubmit={(event) => { event.preventDefault(); saveIdentity.mutate(formPayload(form)); }}><select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as IdentityType }))} disabled={saveIdentity.isPending}><option value="STUDENT">Siswa</option><option value="TEACHER">Guru</option><option value="EMPLOYEE">Pegawai</option></select><input value={form.identifier} onChange={(event) => setForm((current) => ({ ...current, identifier: event.target.value }))} required minLength={2} placeholder="NIS / NIP / ID pegawai"/><input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} required minLength={2} placeholder="Nama lengkap"/><input value={form.barcode} onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))} placeholder="Barcode kartu (opsional)"/>{form.type === "STUDENT" ? <><input value={form.className} onChange={(event) => setForm((current) => ({ ...current, className: event.target.value }))} placeholder="Kelas (opsional)"/><div className="form-pair"><input value={form.grade} onChange={(event) => setForm((current) => ({ ...current, grade: event.target.value }))} placeholder="Tingkat (opsional)"/><input value={form.schoolYear} onChange={(event) => setForm((current) => ({ ...current, schoolYear: event.target.value }))} placeholder="Tahun ajaran (opsional)"/></div></> : <><input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} placeholder="Unit / departemen (opsional)"/><input value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))} placeholder="Jabatan (opsional)"/></>}<input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} type="email" placeholder="Email (opsional)"/><input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Telepon (opsional)"/><button className="primary" disabled={saveIdentity.isPending}>{saveIdentity.isPending ? "Menyimpan…" : editing ? "Simpan perubahan" : "Simpan identitas"}</button>{editing && <button type="button" className="secondary" onClick={() => { setEditing(null); setForm(blankForm); }}>Batal edit</button>}</form></Card>
    </div>
    <div className="grid-two">
      <Card><h2>Template & import Excel</h2><p>Template memakai data contoh sintetis. Preview tidak pernah menulis data; commit hanya tersedia setelah semua error diperbaiki.</p><button className="secondary" disabled={downloading} onClick={() => { void downloadTemplate(); }}>{downloading ? "Menyiapkan…" : "Unduh template .xlsx"}</button>{downloadError && <p className="error" role="alert">{downloadError}</p>}<form className="stack-form" onSubmit={(event) => { event.preventDefault(); if (file) previewImport.mutate(file); else setNotice("Pilih workbook .xlsx terlebih dahulu."); }}><input type="file" accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} required/><button className="primary" disabled={!file || previewImport.isPending}>{previewImport.isPending ? "Memvalidasi…" : "Buat preview aman"}</button></form></Card>
      <Card><h2>Keanggotaan koperasi</h2><p>Hanya guru atau pegawai aktif pada tenant ini yang dapat didaftarkan. Siswa dan identitas nonaktif ditolak server.</p><ProtectedQuery<Paged<Member>> resource="members" path={membersPath} session={session}>{(members) => <><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Cari anggota koperasi"/><QueryState loading={members.isLoading} error={members.error} empty={!members.data?.data.length}><div className="list">{members.data?.data.map((member) => <div className="list-row" key={member.id}><div><strong>{member.name}</strong><small>{member.memberNo} · {member.identity ? `${member.identity.type} ${member.identity.active ? "aktif" : "nonaktif"}` : "legacy tanpa identitas"}</small></div><span className={member.eligible ? "status" : "danger-badge"}>{member.eligible ? "ELIGIBLE" : "TIDAK ELIGIBLE"}</span></div>)}</div></QueryState></>}</ProtectedQuery><ProtectedQuery<Paged<MasterDataRecord>> resource="master-data" path="/master-data?active=true&page=1&pageSize=100" session={session}>{(identities) => { const eligible = (identities.data?.data ?? []).filter((identity) => identity.active && identity.type !== "STUDENT"); const selected = (identities.data?.data ?? []).find((identity) => identity.id === memberIdentityId); return <form className="stack-form" onSubmit={(event) => { event.preventDefault(); createMember.mutate(); }}><select value={memberIdentityId} onChange={(event) => setMemberIdentityId(event.target.value)} required><option value="">Pilih guru atau pegawai aktif</option>{eligible.map((identity) => <option key={identity.id} value={identity.id}>{identity.fullName} · {identity.type} · {identity.identifier}</option>)}</select><input value={memberNo} onChange={(event) => setMemberNo(event.target.value)} required minLength={2} placeholder="Nomor anggota koperasi"/><p className="muted">{membershipEligibilityMessage(selected ? { type: selected.type, active: selected.active } : null)}</p><button className="secondary" disabled={!memberIdentityId || !memberNo || createMember.isPending}>{createMember.isPending ? "Mendaftarkan…" : "Daftarkan anggota"}</button></form>; }}</ProtectedQuery></Card>
    </div>
    {preview && <Card><h2>Konfirmasi preview import</h2><p>Berlaku hingga {new Date(preview.expiresAt).toLocaleString("id-ID")}. {preview.summary.error ? "Perbaiki semua error lalu unggah ulang workbook." : "Klik commit untuk menulis perubahan yang ditampilkan."}</p><div className="metrics"><div className="metric"><p>Buat</p><strong>{preview.summary.create}</strong></div><div className="metric blue"><p>Perbarui</p><strong>{preview.summary.update}</strong></div><div className="metric amber"><p>Lewati</p><strong>{preview.summary.skip}</strong></div><div className="metric violet"><p>Error</p><strong>{preview.summary.error}</strong></div></div>{preview.issues.length > 0 && <div className="list">{preview.issues.map((issue, index) => <p className="error" key={`${issue.row}-${issue.field}-${index}`}>Baris {issue.row}, {issue.field}: {issue.message}</p>)}</div>}<div className="list">{preview.rows.map((row) => <div className="list-row" key={`${row.row}-${row.action}`}><div><strong>Baris {row.row}: {row.fullName ?? row.identifier ?? "data tidak valid"}</strong><small>{row.type ?? ""} {row.identifier ?? ""} {row.reason ? `· ${row.reason}` : ""}</small></div><span className={row.action === "error" ? "danger-badge" : "status"}>{row.action}</span></div>)}</div><button className="primary" disabled={!canCommitImport(preview) || commitImport.isPending} onClick={() => commitImport.mutate(preview)}>{commitImport.isPending ? "Mengunci perubahan…" : "Konfirmasi dan commit import"}</button></Card>}
  </section>;
}
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { api, downloadApiFile, type Session } from "./api";
import { protectedQueryKey } from "./session-cache";
import {
  attachmentWriteRoles,
  hasRole,
  invoiceOutstanding,
  isProtectedResourceQueryKey,
  localDate,
  paymentProofPreflight,
  shuttleErrorMessage,
  shuttleFinanceRoles,
  shuttleInvoiceReadRoles,
  shuttleOpsRoles,
  shuttlePaymentRecordRoles,
  shuttleRouteWriteRoles,
} from "./shuttle-ui";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};
type ListResponse<T> = { data: T[]; pagination?: Pagination };
type ShuttleRoute = {
  id: string;
  code: string;
  name: string;
  stops: string[];
  monthlyRate: number;
  active: boolean;
};
type Rider = {
  id: string;
  memberNo?: string;
  identifier?: string;
  name?: string;
  fullName?: string;
  active?: boolean;
  eligible?: boolean;
};
type ShuttleSubscription = {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  startDate: string;
  endDate: string | null;
  payerName: string | null;
  payerContact: string | null;
  route: ShuttleRoute;
  member: Rider | null;
  studentIdentity: Rider | null;
  invoices: Invoice[];
};
type Payment = {
  id: string;
  amount: number;
  method: "CASH" | "TRANSFER" | "QRIS";
  reference: string;
  status: "RECORDED" | "VERIFIED" | "REVERSED";
  paidAt: string;
  verifiedAt: string | null;
  reversalReason: string | null;
};
type Invoice = {
  id: string;
  invoiceNo: string;
  description: string;
  amount: number;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID";
  issuedAt: string | null;
  dueDate: string | null;
  finalizedAt: string | null;
  routeCodeSnapshot: string | null;
  routeNameSnapshot: string | null;
  proratedDays: number | null;
  periodDays: number | null;
  subscription: { route: ShuttleRoute; member: Rider | null } | null;
  payments: Payment[];
};
type CollectibleInvoice = {
  id: string;
  invoiceNo: string;
  riderName: string | null;
  routeName: string | null;
  billingPeriod: { startsAt: string; endsAt: string } | null;
  amount: number;
  collectibleAmount: number;
  status: "ISSUED";
  dueDate: string | null;
};
type BillingPeriod = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: "OPEN" | "FINALIZED";
  finalizedAt: string | null;
};
type FinancialConfig = {
  vendorName: string;
  vendorShareBps: number;
  cooperativeShareBps: number;
  active: boolean;
};
type Settlement = {
  id: string;
  billingPeriodId: string;
  vendorNameSnapshot: string;
  verifiedAmount: number;
  vendorAmount: number;
  cooperativeAmount: number;
  status: "DRAFT" | "APPROVED" | "PAID";
  paymentReference: string | null;
  billingPeriod: BillingPeriod;
};
type ShuttleReport = {
  billed: number;
  paid: number;
  outstanding: number;
  vendorShare: number;
  cooperativeShare: number;
  settlements: Settlement[];
};
type UploadedProof = {
  id: string;
  entityId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
};

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const money = (value: number) => rupiah.format(Number(value) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const currentYear = () => new Date().getFullYear();
const currentMonth = () => new Date().getMonth() + 1;

function Page({ children }: { children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">SO Shuttle</p>
          <h1>Operasional Shuttle</h1>
          <p>
            Rute, langganan, tagihan, pembayaran, bukti privat, dan settlement
            dalam satu workspace.
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}
function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
function Message({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return <p className={`form-message shuttle-message ${tone}`}>{children}</p>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
function LoadingOrError({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (loading) return <p className="muted">Memuat data Shuttle…</p>;
  if (error)
    return <Message tone="error">{shuttleErrorMessage(error)}</Message>;
  return <>{children}</>;
}

function useShuttleQuery<T>(
  key: string,
  path: string,
  session: Session,
  enabled = true,
) {
  return useQuery({
    queryKey: protectedQueryKey(key, session),
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled,
  });
}

function Pager({
  pagination,
  setPage,
}: {
  pagination?: Pagination;
  setPage: (page: number) => void;
}) {
  if (!pagination || pagination.pageCount < 2) return null;
  return (
    <div className="pager">
      <button
        type="button"
        disabled={pagination.page <= 1}
        onClick={() => setPage(pagination.page - 1)}
      >
        Sebelumnya
      </button>
      <span>
        Halaman {pagination.page} dari {pagination.pageCount}
      </span>
      <button
        type="button"
        disabled={pagination.page >= pagination.pageCount}
        onClick={() => setPage(pagination.page + 1)}
      >
        Berikutnya
      </button>
    </div>
  );
}

function confirmFinancialAction(label: string): boolean {
  return (
    typeof window === "undefined" ||
    window.confirm(
      `Konfirmasi ${label}. Tindakan finansial akan dicatat dan tidak dapat dibatalkan dari layar ini.`,
    )
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ShuttlePage({ session }: { session: Session }) {
  const client = useQueryClient();
  const role = session.user.role;
  const canManageRoute = hasRole(role, shuttleRouteWriteRoles);
  const canManageSubscription = canManageRoute;
  const canOperateBilling = hasRole(role, shuttleOpsRoles);
  const canReadInvoices = hasRole(role, shuttleInvoiceReadRoles);
  const canRecordPayment = hasRole(role, shuttlePaymentRecordRoles);
  const canFinance = hasRole(role, shuttleFinanceRoles);
  const canUploadProof = hasRole(role, attachmentWriteRoles);
  const canReadMasterData = ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role);
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [routeSearch, setRouteSearch] = useState("");
  const [subscriptionSearch, setSubscriptionSearch] = useState("");
  const [routePage, setRoutePage] = useState(1);
  const [subscriptionPage, setSubscriptionPage] = useState(1);
  const [collectibleSearch, setCollectibleSearch] = useState("");
  const [collectiblePage, setCollectiblePage] = useState(1);
  const [riderKind, setRiderKind] = useState<"member" | "student">("member");
  const [proofs, setProofs] = useState<UploadedProof[]>([]);

  const routePath = `/shuttle/routes?active=true&page=${routePage}&pageSize=25${routeSearch.trim() ? `&q=${encodeURIComponent(routeSearch.trim())}` : ""}`;
  const subscriptionPath = `/shuttle/subscriptions?page=${subscriptionPage}&pageSize=25${subscriptionSearch.trim() ? `&q=${encodeURIComponent(subscriptionSearch.trim())}` : ""}`;
  const collectiblePath = `/shuttle/billing/collectible-invoices?page=${collectiblePage}&pageSize=25${collectibleSearch.trim() ? `&q=${encodeURIComponent(collectibleSearch.trim())}` : ""}`;
  const routes = useShuttleQuery<ListResponse<ShuttleRoute>>(
    "shuttle-routes:" + routePath,
    routePath,
    session,
  );
  const subscriptions = useShuttleQuery<ListResponse<ShuttleSubscription>>(
    "shuttle-subscriptions:" + subscriptionPath,
    subscriptionPath,
    session,
  );
  const members = useShuttleQuery<ListResponse<Rider>>(
    "shuttle-members",
    "/members?page=1&pageSize=100",
    session,
    canManageSubscription,
  );
  const students = useShuttleQuery<ListResponse<Rider>>(
    "shuttle-students",
    "/master-data?type=STUDENT&active=true&page=1&pageSize=100",
    session,
    canManageSubscription && canReadMasterData,
  );
  const periods = useShuttleQuery<ListResponse<BillingPeriod>>(
    "shuttle-periods",
    "/shuttle/billing-periods",
    session,
    canOperateBilling,
  );
  const invoices = useShuttleQuery<ListResponse<Invoice>>(
    "shuttle-invoices",
    "/billing/invoices",
    session,
    canReadInvoices,
  );
  const collectibleInvoices = useShuttleQuery<ListResponse<CollectibleInvoice>>(
    "shuttle-collectible-invoices:" + collectiblePath,
    collectiblePath,
    session,
    canRecordPayment,
  );
  const config = useShuttleQuery<{ data: FinancialConfig | null }>(
    "shuttle-config",
    "/shuttle/financial-config",
    session,
    canFinance,
  );
  const settlements = useShuttleQuery<ListResponse<Settlement>>(
    "shuttle-settlements",
    "/shuttle/settlements",
    session,
    canFinance,
  );
  const report = useShuttleQuery<ShuttleReport>(
    "shuttle-report",
    "/shuttle/report",
    session,
    canFinance,
  );

  const refresh = (...resources: string[]) =>
    Promise.all(
      resources.map((resource) =>
        client.invalidateQueries({
          predicate: (query) =>
            isProtectedResourceQueryKey(query.queryKey, resource),
        }),
      ),
    );
  const failure = (cause: unknown) =>
    setNotice({ tone: "error", text: shuttleErrorMessage(cause) });
  const success = (text: string) => setNotice({ tone: "success", text });
  const activeRoutes = routes.data?.data ?? [];
  const eligibleMembers = (members.data?.data ?? []).filter(
    (member) => member.eligible && member.active !== false,
  );
  const activeStudents = students.data?.data ?? [];
  const invoiceList = invoices.data?.data ?? [];
  const collectibleInvoiceList = collectibleInvoices.data?.data ?? [];
  const periodList = periods.data?.data ?? [];
  const settlementList = settlements.data?.data ?? [];

  const createRoute = useMutation({
    mutationFn: (body: unknown) =>
      api<ShuttleRoute>("/shuttle/routes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      success("Rute tersimpan.");
      void refresh("shuttle-routes");
    },
    onError: failure,
  });
  const createSubscription = useMutation({
    mutationFn: (body: unknown) =>
      api<ShuttleSubscription>("/shuttle/subscriptions", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      success("Langganan aktif tersimpan.");
      void refresh("shuttle-subscriptions");
    },
    onError: failure,
  });
  const cancelSubscription = useMutation({
    mutationFn: ({ subscriptionId, reason }: { subscriptionId: string; reason: string }) =>
      api<ShuttleSubscription>(`/shuttle/subscriptions/${subscriptionId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      success("Langganan dibatalkan; riwayat dan tagihan sebelumnya tetap tersimpan.");
      void refresh("shuttle-subscriptions");
    },
    onError: failure,
  });
  const createPeriod = useMutation({
    mutationFn: (body: unknown) =>
      api<BillingPeriod>("/shuttle/billing-periods", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      success("Periode tagihan tersedia.");
      void refresh("shuttle-periods");
    },
    onError: failure,
  });
  const generateInvoices = useMutation({
    mutationFn: (periodId: string) =>
      api<{ created: number }>(
        `/shuttle/billing-periods/${periodId}/generate`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: (data) => {
      success(`${data.created} draft invoice dibuat.`);
      void refresh("shuttle-periods", "shuttle-invoices");
    },
    onError: failure,
  });
  const finalizePeriod = useMutation({
    mutationFn: (periodId: string) =>
      api<BillingPeriod>(`/shuttle/billing-periods/${periodId}/finalize`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      success("Periode dan invoice telah difinalisasi.");
      void refresh("shuttle-periods", "shuttle-invoices");
    },
    onError: failure,
  });
  const recordPayment = useMutation({
    mutationFn: ({ invoiceId, body }: { invoiceId: string; body: unknown }) =>
      api<Payment>(`/billing/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      success("Pembayaran dicatat.");
      void refresh("shuttle-invoices", "shuttle-collectible-invoices", "shuttle-report");
    },
    onError: failure,
  });
  const voidInvoice = useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason: string }) =>
      api<Invoice>(`/billing/invoices/${invoiceId}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      success("Invoice dibatalkan. Nilainya tidak lagi dihitung dalam dashboard Shuttle.");
      void refresh("shuttle-invoices", "shuttle-report");
    },
    onError: failure,
  });
  const verifyPayment = useMutation({
    mutationFn: (paymentId: string) =>
      api<Payment>(`/billing/payments/${paymentId}/verify`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      success("Pembayaran terverifikasi.");
      void refresh("shuttle-invoices", "shuttle-report", "shuttle-settlements");
    },
    onError: failure,
  });
  const reversePayment = useMutation({
    mutationFn: ({
      paymentId,
      reason,
    }: {
      paymentId: string;
      reason: string;
    }) =>
      api<Payment>(`/billing/payments/${paymentId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      success("Pembayaran dibalik; status invoice dihitung ulang.");
      void refresh("shuttle-invoices", "shuttle-report", "shuttle-settlements");
    },
    onError: failure,
  });
  const saveConfig = useMutation({
    mutationFn: (body: unknown) =>
      api<FinancialConfig>("/shuttle/financial-config", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      success("Konfigurasi pembagian hasil tersimpan.");
      void refresh("shuttle-config");
    },
    onError: failure,
  });
  const generateSettlement = useMutation({
    mutationFn: (periodId: string) =>
      api<Settlement>(`/shuttle/billing-periods/${periodId}/settlements`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      success("Settlement dibuat atau dipakai kembali secara idempoten.");
      void refresh("shuttle-settlements", "shuttle-report");
    },
    onError: failure,
  });
  const approveSettlement = useMutation({
    mutationFn: (settlementId: string) =>
      api<Settlement>(`/shuttle/settlements/${settlementId}/approve`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      success("Settlement disetujui.");
      void refresh("shuttle-settlements", "shuttle-report");
    },
    onError: failure,
  });
  const markSettlementPaid = useMutation({
    mutationFn: ({
      settlementId,
      reference,
    }: {
      settlementId: string;
      reference: string;
    }) =>
      api<Settlement>(`/shuttle/settlements/${settlementId}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ reference }),
      }),
    onSuccess: () => {
      success("Settlement ditandai paid dengan referensi tercatat.");
      void refresh("shuttle-settlements", "shuttle-report");
    },
    onError: failure,
  });
  const uploadProof = useMutation({
    mutationFn: ({ paymentId, file }: { paymentId: string; file: File }) => {
      const body = new FormData();
      body.set("entityType", "Payment");
      body.set("entityId", paymentId);
      body.set("file", file);
      return api<UploadedProof>("/attachments", { method: "POST", body });
    },
    onSuccess: (proof) => {
      setProofs((current) => [proof, ...current]);
      success("Bukti pembayaran tersimpan privat.");
    },
    onError: failure,
  });

  const financeSummary = useMemo(
    () =>
      report.data
        ? [
            ["Ditagihkan", money(report.data.billed)],
            ["Terverifikasi", money(report.data.paid)],
            ["Tunggakan", money(report.data.outstanding)],
            ["Bagian vendor", money(report.data.vendorShare)],
            ["Bagian koperasi", money(report.data.cooperativeShare)],
          ]
        : [],
    [report.data],
  );

  const submitRoute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createRoute.mutate({
      code: String(form.get("code") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      stops: String(form.get("stops") ?? "")
        .split(",")
        .map((stop) => stop.trim())
        .filter(Boolean),
      monthlyRate: Number(form.get("monthlyRate")),
    });
  };
  const submitSubscription = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const riderId = String(form.get("riderId") ?? "");
    createSubscription.mutate({
      ...(riderKind === "student"
        ? { studentIdentityId: riderId }
        : { memberId: riderId }),
      routeId: String(form.get("routeId") ?? ""),
      startDate: String(form.get("startDate") ?? ""),
      endDate: String(form.get("endDate") ?? "") || undefined,
      payerName: String(form.get("payerName") ?? "").trim() || undefined,
      payerContact: String(form.get("payerContact") ?? "").trim() || undefined,
    });
  };
  const submitPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invoiceId = String(form.get("invoiceId") ?? "");
    if (!confirmFinancialAction("pencatatan pembayaran")) return;
    recordPayment.mutate({
      invoiceId,
      body: {
        amount: Number(form.get("amount")),
        method: String(form.get("method")),
        reference: String(form.get("reference") ?? "").trim(),
      },
    });
  };
  const requestCorrectionReason = (label: string): string | undefined => {
    if (typeof window === "undefined") return undefined;
    const reason = window.prompt(`Alasan ${label} (minimal 5 karakter):`);
    const normalized = reason?.trim();
    return normalized && normalized.length >= 5 ? normalized : undefined;
  };

  return (
    <Page>
      {notice && <Message tone={notice.tone}>{notice.text}</Message>}
      <section className="shuttle-section" aria-labelledby="shuttle-routes">
        <div className="section-heading">
          <div>
            <h2 id="shuttle-routes">Rute dan langganan</h2>
            <p>
              Seluruh daftar dibatasi pada tenant aktif. Pembatalan langganan
              mempertahankan riwayat dan menghentikan pembuatan tagihan baru.
            </p>
          </div>
        </div>
        <div className="grid-two">
          <Card>
            <div className="card-heading">
              <h3>Rute aktif</h3>
              <input
                aria-label="Cari rute"
                value={routeSearch}
                onChange={(event) => {
                  setRouteSearch(event.target.value);
                  setRoutePage(1);
                }}
                placeholder="Cari kode atau nama"
              />
            </div>
            <LoadingOrError loading={routes.isLoading} error={routes.error}>
              {activeRoutes.length ? (
                <div className="list">
                  {activeRoutes.map((route) => (
                    <div className="list-row" key={route.id}>
                      <div>
                        <strong>{route.name}</strong>
                        <small>
                          {route.code} · {route.stops.join(" → ")}
                        </small>
                      </div>
                      <strong>{money(route.monthlyRate)}/bulan</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>Belum ada rute aktif.</Empty>
              )}
              <Pager
                pagination={routes.data?.pagination}
                setPage={setRoutePage}
              />
            </LoadingOrError>
          </Card>
          <Card>
            <div className="card-heading">
              <h3>Langganan aktif</h3>
              <input
                aria-label="Cari langganan"
                value={subscriptionSearch}
                onChange={(event) => {
                  setSubscriptionSearch(event.target.value);
                  setSubscriptionPage(1);
                }}
                placeholder="Cari rider atau rute"
              />
            </div>
            <LoadingOrError
              loading={subscriptions.isLoading}
              error={subscriptions.error}
            >
              {(subscriptions.data?.data ?? []).length ? (
                <div className="list">
                  {subscriptions.data!.data.map((subscription) => {
                    const rider =
                      subscription.studentIdentity ?? subscription.member;
                    return (
                      <div className="list-row" key={subscription.id}>
                        <div>
                          <strong>
                            {rider?.fullName ?? rider?.name ?? "Rider"}
                          </strong>
                          <small>
                            {subscription.route.name} · mulai{" "}
                            {localDate(subscription.startDate)}
                            {subscription.endDate
                              ? ` hingga ${localDate(subscription.endDate)}`
                              : ""}
                          </small>
                        </div>
                        <div className="button-row">
                          <span className="status">{subscription.status}</span>
                          {canManageSubscription && subscription.status === "ACTIVE" && (
                            <button
                              type="button"
                              className="danger-button"
                              disabled={cancelSubscription.isPending}
                              onClick={() => {
                                const reason = requestCorrectionReason("pembatalan langganan");
                                if (reason && confirmFinancialAction("pembatalan langganan")) {
                                  cancelSubscription.mutate({ subscriptionId: subscription.id, reason });
                                }
                              }}
                            >
                              Batalkan
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty>Belum ada langganan.</Empty>
              )}
              <Pager
                pagination={subscriptions.data?.pagination}
                setPage={setSubscriptionPage}
              />
            </LoadingOrError>
          </Card>
        </div>
        <div className="grid-two">
          {canManageRoute && (
            <Card>
              <h3>Tambah rute</h3>
              <form className="stack-form" onSubmit={submitRoute}>
                <input
                  name="code"
                  required
                  minLength={2}
                  maxLength={30}
                  placeholder="Kode rute"
                />
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Nama rute"
                />
                <textarea
                  name="stops"
                  required
                  placeholder="Halte dipisahkan koma, minimal dua"
                />
                <input
                  name="monthlyRate"
                  type="number"
                  required
                  min="1"
                  max="999999999"
                  placeholder="Tarif bulanan (Rupiah)"
                />
                <button className="primary" disabled={createRoute.isPending}>
                  {createRoute.isPending ? "Menyimpan…" : "Simpan rute"}
                </button>
              </form>
            </Card>
          )}
          {canManageSubscription && (
            <Card>
              <h3>Aktifkan langganan</h3>
              <form className="stack-form" onSubmit={submitSubscription}>
                <div className="button-row">
                  <button
                    type="button"
                    className={riderKind === "member" ? "primary" : "secondary"}
                    onClick={() => setRiderKind("member")}
                  >
                    Anggota
                  </button>
                  {canReadMasterData && (
                    <button
                      type="button"
                      className={
                        riderKind === "student" ? "primary" : "secondary"
                      }
                      onClick={() => setRiderKind("student")}
                    >
                      Siswa
                    </button>
                  )}
                </div>
                <select name="riderId" required defaultValue="">
                  <option value="" disabled>
                    {riderKind === "student"
                      ? "Pilih siswa"
                      : "Pilih anggota eligible"}
                  </option>
                  {(riderKind === "student"
                    ? activeStudents
                    : eligibleMembers
                  ).map((rider) => (
                    <option key={rider.id} value={rider.id}>
                      {rider.fullName ?? rider.name} ·{" "}
                      {rider.identifier ?? rider.memberNo}
                    </option>
                  ))}
                </select>
                {riderKind === "student" && !canReadMasterData && (
                  <Message tone="info">
                    Daftar siswa hanya tersedia bagi peran administrasi Master
                    Data.
                  </Message>
                )}
                <select name="routeId" required defaultValue="">
                  <option value="" disabled>
                    Pilih rute aktif
                  </option>
                  {activeRoutes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.code} — {route.name}
                    </option>
                  ))}
                </select>
                <div className="form-pair">
                  <input
                    name="startDate"
                    type="date"
                    required
                    defaultValue={today()}
                  />
                  <input name="endDate" type="date" min={today()} />
                </div>
                <input
                  name="payerName"
                  maxLength={120}
                  placeholder="Nama wali/pembayar (opsional)"
                />
                <input
                  name="payerContact"
                  maxLength={120}
                  placeholder="Kontak wali/pembayar (opsional)"
                />
                <button
                  className="primary"
                  disabled={createSubscription.isPending}
                >
                  {createSubscription.isPending
                    ? "Menyimpan…"
                    : "Aktifkan langganan"}
                </button>
              </form>
            </Card>
          )}
        </div>
      </section>

      {canOperateBilling && (
        <section className="shuttle-section" aria-labelledby="shuttle-billing">
          <div className="section-heading">
            <div>
              <h2 id="shuttle-billing">Periode dan invoice</h2>
              <p>
                Generate membuat draft secara idempoten. Finalisasi mengunci
                periode dan menerbitkan draft invoice sesuai backend.
              </p>
            </div>
          </div>
          <div className="grid-two">
            <Card>
              <h3>Periode tagihan</h3>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  createPeriod.mutate({
                    year: Number(form.get("year")),
                    month: Number(form.get("month")),
                  });
                }}
              >
                <input
                  name="year"
                  type="number"
                  min="2020"
                  max="2100"
                  defaultValue={currentYear()}
                  required
                />
                <input
                  name="month"
                  type="number"
                  min="1"
                  max="12"
                  defaultValue={currentMonth()}
                  required
                />
                <button className="secondary" disabled={createPeriod.isPending}>
                  Buat periode
                </button>
              </form>
              <LoadingOrError loading={periods.isLoading} error={periods.error}>
                {periodList.length ? (
                  <div className="list">
                    {periodList.map((period) => (
                      <div className="list-row" key={period.id}>
                        <div>
                          <strong>
                            {localDate(period.startsAt)} —{" "}
                            {localDate(period.endsAt)}
                          </strong>
                          <small>
                            {period.timezone} · {period.status}
                          </small>
                        </div>
                        <div className="button-row">
                          {period.status === "OPEN" && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={generateInvoices.isPending}
                              onClick={() => {
                                if (
                                  confirmFinancialAction(
                                    "pembuatan draft invoice",
                                  )
                                )
                                  generateInvoices.mutate(period.id);
                              }}
                            >
                              Generate
                            </button>
                          )}
                          {period.status === "OPEN" && canFinance && (
                            <button
                              type="button"
                              className="primary"
                              disabled={finalizePeriod.isPending}
                              onClick={() => {
                                if (
                                  confirmFinancialAction("finalisasi periode")
                                )
                                  finalizePeriod.mutate(period.id);
                              }}
                            >
                              Finalisasi
                            </button>
                          )}
                          {period.status === "FINALIZED" && canFinance && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={generateSettlement.isPending}
                              onClick={() => {
                                if (
                                  confirmFinancialAction("pembuatan settlement")
                                )
                                  generateSettlement.mutate(period.id);
                              }}
                            >
                              Settlement
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>Belum ada periode tagihan.</Empty>
                )}
              </LoadingOrError>
            </Card>
            <Card>
              <h3>Rekap invoice</h3>
              {!canReadInvoices ? (
                <Message tone="info">
                  Peran ini tidak diizinkan membaca daftar invoice. Pencatatan
                  pembayaran memerlukan akses invoice dari backend.
                </Message>
              ) : (
                <LoadingOrError
                  loading={invoices.isLoading}
                  error={invoices.error}
                >
                  {invoiceList.length ? (
                    <div className="list">
                      {invoiceList.map((invoice) => (
                        <div className="list-row" key={invoice.id}>
                          <div>
                            <strong>{invoice.invoiceNo}</strong>
                            <small>
                              {invoice.description} ·{" "}
                              {invoice.proratedDays && invoice.periodDays
                                ? `Prorata ${invoice.proratedDays}/${invoice.periodDays} hari`
                                : "Nominal final"}
                            </small>
                          </div>
                          <div className="button-row">
                            <span className="status">{invoice.status}</span>
                            <strong>
                              {money(
                                invoiceOutstanding(
                                  invoice.amount,
                                  invoice.payments,
                                ),
                              )}
                            </strong>
                            {canFinance && invoice.status !== "VOID" && invoice.payments.length === 0 && (
                              <button
                                type="button"
                                className="danger-button"
                                disabled={voidInvoice.isPending}
                                onClick={() => {
                                  const reason = requestCorrectionReason("pembatalan invoice");
                                  if (reason && confirmFinancialAction("pembatalan invoice")) {
                                    voidInvoice.mutate({ invoiceId: invoice.id, reason });
                                  }
                                }}
                              >
                                Void invoice
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>Belum ada invoice pada workspace ini.</Empty>
                  )}
                </LoadingOrError>
              )}
            </Card>
          </div>
        </section>
      )}

      {(canReadInvoices || canRecordPayment) && (
        <section className="shuttle-section" aria-labelledby="shuttle-payments">
          <div className="section-heading">
            <div>
              <h2 id="shuttle-payments">Pembayaran dan bukti privat</h2>
              <p>
                Outstanding dihitung dari payment VERIFIED. Bukti dapat diunduh
                hanya lewat sesi terautentikasi, tanpa URL publik.
              </p>
            </div>
          </div>
          <div className="grid-two">
            <Card>
              <h3>Catat pembayaran</h3>
              {canRecordPayment ? (
                <LoadingOrError loading={collectibleInvoices.isLoading} error={collectibleInvoices.error}>
                  <input
                    aria-label="Cari invoice collectible"
                    value={collectibleSearch}
                    onChange={(event) => {
                      setCollectibleSearch(event.target.value);
                      setCollectiblePage(1);
                    }}
                    placeholder="Cari nomor invoice atau rute"
                  />
                  <form className="stack-form" onSubmit={submitPayment}>
                    <select name="invoiceId" required defaultValue="">
                      <option value="" disabled>
                        Pilih invoice yang dapat ditagih
                      </option>
                      {collectibleInvoiceList.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.invoiceNo} · sisa {money(invoice.collectibleAmount)}
                        </option>
                      ))}
                    </select>
                    <input name="amount" type="number" required min="1" max="999999999" placeholder="Nominal Rupiah" />
                    <select name="method" defaultValue="TRANSFER">
                      <option value="CASH">Tunai</option>
                      <option value="TRANSFER">Transfer</option>
                      <option value="QRIS">QRIS</option>
                    </select>
                    <input name="reference" required minLength={3} maxLength={80} placeholder="Referensi pembayaran" />
                    <button className="primary" disabled={recordPayment.isPending || !collectibleInvoiceList.length}>
                      {recordPayment.isPending ? "Mencatat…" : "Catat pembayaran"}
                    </button>
                  </form>
                  {!collectibleInvoiceList.length && !collectibleInvoices.isLoading && <Empty>Tidak ada invoice yang dapat ditagih.</Empty>}
                  <Pager pagination={collectibleInvoices.data?.pagination} setPage={setCollectiblePage} />
                </LoadingOrError>
              ) : (
                <Message tone="info">
                  Peran ini tidak dapat mencatat pembayaran.
                </Message>
              )}
            </Card>
            {canReadInvoices && <Card>
              <h3>Riwayat dan tindakan payment</h3>
              <LoadingOrError
                loading={invoices.isLoading}
                error={invoices.error}
              >
                {invoiceList.some((invoice) => invoice.payments.length) ? (
                  <div className="list">
                    {invoiceList.flatMap((invoice) =>
                      invoice.payments.map((payment) => (
                        <div
                          className="list-row shuttle-payment"
                          key={payment.id}
                        >
                          <div>
                            <strong>
                              {invoice.invoiceNo} · {money(payment.amount)}
                            </strong>
                            <small>
                              {payment.method} · {payment.reference} ·{" "}
                              {localDate(payment.paidAt)}
                            </small>
                            <small>
                              Status: {payment.status}
                              {payment.reversalReason
                                ? ` · ${payment.reversalReason}`
                                : ""}
                            </small>
                          </div>
                          <div className="button-row">
                            {canFinance && payment.status === "RECORDED" && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={verifyPayment.isPending}
                                onClick={() => {
                                  if (
                                    confirmFinancialAction(
                                      "verifikasi pembayaran",
                                    )
                                  )
                                    verifyPayment.mutate(payment.id);
                                }}
                              >
                                Verifikasi
                              </button>
                            )}
                            {canFinance && payment.status !== "REVERSED" && (
                              <button
                                type="button"
                                className="danger-button"
                                disabled={reversePayment.isPending}
                                onClick={() => {
                                  const reason = window.prompt(
                                    "Alasan reversal pembayaran (minimal 5 karakter)",
                                  );
                                  if (
                                    reason &&
                                    reason.trim().length >= 5 &&
                                    confirmFinancialAction(
                                      "reversal pembayaran",
                                    )
                                  )
                                    reversePayment.mutate({
                                      paymentId: payment.id,
                                      reason: reason.trim(),
                                    });
                                }}
                              >
                                Reverse
                              </button>
                            )}
                            {canUploadProof && (
                              <label className="file-button">
                                Unggah bukti
                                <input
                                  type="file"
                                  accept="application/pdf,image/jpeg,image/png,image/webp"
                                  hidden
                                  onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    const validationError = file
                                      ? paymentProofPreflight(file)
                                      : undefined;
                                    if (validationError) {
                                      setNotice({
                                        tone: "error",
                                        text: validationError,
                                      });
                                    } else if (file) {
                                      uploadProof.mutate({
                                        paymentId: payment.id,
                                        file,
                                      });
                                    }
                                    event.currentTarget.value = "";
                                  }}
                                />
                              </label>
                            )}
                            {proofs
                              .filter((proof) => proof.entityId === payment.id)
                              .map((proof) => (
                                <button
                                  type="button"
                                  className="secondary"
                                  key={proof.id}
                                  onClick={async () => {
                                    try {
                                      downloadBlob(
                                        await downloadApiFile(
                                          `/attachments/${proof.id}/download`,
                                        ),
                                        proof.filename,
                                      );
                                    } catch (cause) {
                                      failure(cause);
                                    }
                                  }}
                                >
                                  Unduh {proof.filename}
                                </button>
                              ))}
                          </div>
                        </div>
                      )),
                    )}
                  </div>
                ) : (
                  <Empty>Belum ada payment tercatat.</Empty>
                )}
              </LoadingOrError>
            </Card>}
          </div>
        </section>
      )}

      {canFinance && (
        <section
          className="shuttle-section"
          aria-labelledby="shuttle-settlement"
        >
          <div className="section-heading">
            <div>
              <h2 id="shuttle-settlement">Settlement dan laporan</h2>
              <p>
                Pembagian vendor/koperasi berasal dari konfigurasi tersimpan;
                browser tidak menghitung atau mengirim nominal share.
              </p>
            </div>
          </div>
          <div className="grid-two">
            <Card>
              <h3>Konfigurasi bagi hasil</h3>
              <LoadingOrError loading={config.isLoading} error={config.error}>
                <form
                  className="stack-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const vendorShareBps = Number(form.get("vendorShareBps"));
                    const cooperativeShareBps = Number(
                      form.get("cooperativeShareBps"),
                    );
                    if (vendorShareBps + cooperativeShareBps !== 10_000) {
                      setNotice({
                        tone: "error",
                        text: "Total share harus tepat 10.000 basis points (100%).",
                      });
                      return;
                    }
                    if (
                      confirmFinancialAction(
                        "penyimpanan konfigurasi bagi hasil",
                      )
                    )
                      saveConfig.mutate({
                        vendorName: String(form.get("vendorName") ?? "").trim(),
                        vendorShareBps,
                        cooperativeShareBps,
                      });
                  }}
                >
                  <input
                    name="vendorName"
                    required
                    minLength={2}
                    maxLength={160}
                    defaultValue={config.data?.data?.vendorName ?? ""}
                    placeholder="Nama vendor"
                  />
                  <div className="form-pair">
                    <input
                      name="vendorShareBps"
                      required
                      type="number"
                      min="0"
                      max="10000"
                      defaultValue={config.data?.data?.vendorShareBps ?? ""}
                      placeholder="Share vendor (bps)"
                    />
                    <input
                      name="cooperativeShareBps"
                      required
                      type="number"
                      min="0"
                      max="10000"
                      defaultValue={
                        config.data?.data?.cooperativeShareBps ?? ""
                      }
                      placeholder="Share koperasi (bps)"
                    />
                  </div>
                  <small>
                    Basis points: 10.000 = 100%. Nilai disimpan dan disnapshot
                    saat settlement dibuat.
                  </small>
                  <button className="primary" disabled={saveConfig.isPending}>
                    {saveConfig.isPending ? "Menyimpan…" : "Simpan konfigurasi"}
                  </button>
                </form>
              </LoadingOrError>
            </Card>
            <Card>
              <h3>Settlement</h3>
              <LoadingOrError
                loading={settlements.isLoading}
                error={settlements.error}
              >
                {settlementList.length ? (
                  <div className="list">
                    {settlementList.map((settlement) => (
                      <div className="list-row" key={settlement.id}>
                        <div>
                          <strong>
                            {settlement.vendorNameSnapshot} ·{" "}
                            {settlement.status}
                          </strong>
                          <small>
                            Basis {money(settlement.verifiedAmount)} · Vendor{" "}
                            {money(settlement.vendorAmount)} · Koperasi{" "}
                            {money(settlement.cooperativeAmount)}
                          </small>
                        </div>
                        <div className="button-row">
                          {settlement.status === "DRAFT" && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={approveSettlement.isPending}
                              onClick={() => {
                                if (
                                  confirmFinancialAction(
                                    "persetujuan settlement",
                                  )
                                )
                                  approveSettlement.mutate(settlement.id);
                              }}
                            >
                              Setujui
                            </button>
                          )}
                          {settlement.status === "APPROVED" && (
                            <button
                              type="button"
                              className="primary"
                              disabled={markSettlementPaid.isPending}
                              onClick={() => {
                                const reference = window.prompt(
                                  "Referensi pembayaran settlement (minimal 3 karakter)",
                                );
                                if (
                                  reference &&
                                  reference.trim().length >= 3 &&
                                  confirmFinancialAction(
                                    "penandaan settlement paid",
                                  )
                                )
                                  markSettlementPaid.mutate({
                                    settlementId: settlement.id,
                                    reference: reference.trim(),
                                  });
                              }}
                            >
                              Tandai paid
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Belum ada settlement. Finalisasi periode lalu buat
                    settlement.
                  </Empty>
                )}
              </LoadingOrError>
            </Card>
          </div>
          <Card>
            <h3>Dashboard Shuttle</h3>
            <LoadingOrError loading={report.isLoading} error={report.error}>
              {financeSummary.length ? (
                <div className="metrics shuttle-metrics">
                  {financeSummary.map(([label, value]) => (
                    <div className="metric blue" key={label}>
                      <p>{label}</p>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>Belum ada data laporan.</Empty>
              )}
            </LoadingOrError>
          </Card>
        </section>
      )}

      {!canOperateBilling && !canReadInvoices && (
        <Message tone="info">
          Akun ini dapat melihat rute/langganan yang diizinkan, namun tidak
          memiliki akses operasional atau finansial Shuttle.
        </Message>
      )}
    </Page>
  );
}

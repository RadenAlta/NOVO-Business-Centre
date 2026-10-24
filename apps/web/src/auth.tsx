import { useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "./api";

export function AccessPage({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const payload = mode === "login"
        ? { tenantSlug: String(form.get("tenantSlug")), email: String(form.get("email")), password: String(form.get("password")) }
        : { tenantName: String(form.get("tenantName")), slug: String(form.get("tenantSlug")), ownerName: String(form.get("ownerName")), email: String(form.get("email")), password: String(form.get("password")) };
      onSuccess(await api<Session>(mode === "login" ? "/auth/login" : "/auth/bootstrap", { method: "POST", body: JSON.stringify(payload) }));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Tidak dapat menghubungi layanan NOVO."); }
    finally { setLoading(false); }
  }
  return <main className="access"><section className="access-copy"><div className="brand"><span>N</span><div><strong>NOVO</strong><small>Business Centre</small></div></div><h1>Operasional koperasi, dalam satu ruang kerja.</h1><p>Kelola toko, shuttle, catering, simpanan, pembiayaan, dan pengadaan dengan data yang saling terhubung.</p><p className="notice">Gunakan workspace demo setelah menjalankan seed: <code>demo-novo</code></p></section>
  <section className="auth-card"><div className="tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Masuk</button><button type="button" className={mode === "bootstrap" ? "active" : ""} onClick={() => setMode("bootstrap")}>Buat workspace</button></div><form onSubmit={submit}>
    {mode === "bootstrap" && <><label>Nama organisasi<input name="tenantName" required placeholder="Koperasi NOVO" /></label><label>Nama pemilik<input name="ownerName" required placeholder="Nama Anda" /></label></>}
    <label>Slug workspace<input name="tenantSlug" required pattern="[a-z0-9-]{3,50}" placeholder="demo-novo" /></label><label>Email<input name="email" type="email" required placeholder="owner@contoh.id" /></label><label>Kata sandi<input name="password" type="password" minLength={mode === "bootstrap" ? 12 : 1} required placeholder="••••••••••••" /></label>
    {error && <p className="error">{error}</p>}<button className="primary" disabled={loading}>{loading ? "Memproses…" : mode === "login" ? "Masuk ke NOVO" : "Buat workspace aman"}</button>
  </form></section></main>;
}

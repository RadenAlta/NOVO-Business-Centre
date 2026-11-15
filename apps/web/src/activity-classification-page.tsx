import { useState } from "react";

import { api, type Session } from "./api";
import {
  activityCategories,
  activityClassificationErrorMessage,
  canUseActivityClassification,
  manualActivityDraft,
  type ActivityCategory,
  type ActivityClassification,
} from "./activity-classification";

export function ActivityClassificationPage({ session }: { session: Session }) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActivityClassification | null>(null);
  const [manualCategory, setManualCategory] = useState<ActivityCategory | "">("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const allowed = canUseActivityClassification(session.user.role);

  const requestSuggestion = async () => {
    setPending(true);
    setMessage("");
    setResult(null);
    try {
      const next = await api<ActivityClassification>("/analytics/activity-classification", {
        method: "POST",
        body: JSON.stringify({ noteDeidentified: note }),
      });
      setResult(next);
      setManualCategory("");
    } catch (cause) {
      setMessage(activityClassificationErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const draft = manualCategory ? manualActivityDraft(manualCategory) : undefined;
  return <section className="page">
    <header className="page-header"><div><p className="eyebrow">F4 · Saran model terlatih</p><h1>Klasifikasi aktivitas</h1><p>Masukkan catatan yang sudah dihapus identitasnya. AI hanya memberi saran; tidak ada aktivitas atau transaksi yang disimpan pada checkpoint ini.</p></div></header>
    <div className="grid-two wide-left">
      <section className="card">
        <h2>Catatan aktivitas</h2>
        <p className="muted">Hindari nama, nomor telepon, alamat, atau informasi pribadi. Gunakan 3–500 karakter.</p>
        {allowed ? <form className="stack-form" onSubmit={(event) => { event.preventDefault(); void requestSuggestion(); }}>
          <label htmlFor="activity-note">Catatan terdeidentifikasi</label>
          <textarea id="activity-note" value={note} maxLength={500} minLength={3} required onChange={(event) => setNote(event.target.value)} placeholder="Contoh: Stok minuman perlu dihitung ulang sebelum toko dibuka." />
          <button className="primary" disabled={pending || note.trim().length < 3}>{pending ? "Meminta saran…" : "Minta saran kategori"}</button>
        </form> : <p className="error" role="alert">Akun ini tidak memiliki akses untuk meminta saran kategori. Anda tetap dapat memilih kategori manual untuk draft.</p>}
        {message && <p className="error" role="alert">{message}</p>}
      </section>
      <section className="card" aria-live="polite">
        <h2>Keputusan pengguna</h2>
        {result ? <div className="answer"><div><strong>Saran AI: {result.predictedCategory}</strong><p>Model {result.modelVersion}; label {result.labelVersion}. {result.confidence !== undefined ? `Confidence ${Math.round(result.confidence * 100)}% adalah sinyal model, bukan kepastian.` : "Skor keputusan bukan probabilitas."}</p><button type="button" className="secondary" onClick={() => setManualCategory(result.predictedCategory)}>Gunakan saran sebagai draft</button></div></div> : <p className="muted">Belum ada saran AI. Pilih kategori manual jika diperlukan.</p>}
        <label className="stack-form" htmlFor="manual-category">Kategori draft manual
          <select id="manual-category" value={manualCategory} onChange={(event) => setManualCategory(event.target.value as ActivityCategory)}>
            <option value="">Pilih kategori</option>
            {activityCategories.map((category) => <option value={category} key={category}>{category}</option>)}
          </select>
        </label>
        {draft && <p className="form-message">Kategori {draft.category} dipilih sebagai draft manual. Belum disimpan ke database dan tidak mengubah transaksi.</p>}
      </section>
    </div>
  </section>;
}

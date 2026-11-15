# Kamus Data Aktivitas F4 v0 2

Dataset `activity-dataset-v0.2` adalah korpus pengembangan sintetis untuk F4. Ia bukan data operasional koperasi.

| Field | Contoh | Penggunaan | Batas keamanan |
| --- | --- | --- | --- |
| `activity_id` | `act-syn-v02-20261105-00-00` | Identitas record reproduktif | Pseudonim, bukan primary key bisnis. |
| `occurred_at` | `2026-01-01T08:00:00Z` | Urutan sintetis dan audit reproduksi | Bukan waktu aktivitas nyata. |
| `business_unit` | `SHUTTLE` | Konteks analisis | Tidak boleh dipakai sebagai pengganti kontrol akses. |
| `note_deidentified` | Catatan sintetis | Fitur teks model | Tidak boleh berisi PII atau nomor transaksi. |
| `category_label` | `SERVICE` | Target supervised learning | Provisional, perlu approval PIC. |
| `source_type` | `SYNTHETIC` | Provenance | v0.2 tidak mencampur data nyata. |
| `label_version` | `activity-category-v0.1` | Kompatibilitas taxonomy | Berubah hanya bila taxonomy berubah. |
| `provenance` | `synthetic-generator-v2...` | Reproducibility | Wajib memuat asal/seed/batas. |
| `split` | `TEST` | Pemisahan eksperimen | Test dibekukan sebelum eksperimen. |
| `template_family` | `service-route-change` | Group split/leakage audit | Tidak pernah menjadi fitur model. |
| `semantic_group` | `service-route-change` | Audit parafrasa semantik | Tidak pernah menjadi fitur model. |
| `primary_action` | `route_communication` | Dasar review label | Dokumentasi, bukan prediksi. |
| `review_status` | `AMBIGUOUS_REVIEWED` | Antrian pengawasan manusia | Tidak mengizinkan model mengambil keputusan. |

# NOVO × Asah 2026 — Windows/GitHub Master Backlog (v2)

**Local repository:** `C:\Users\raden\dev\projects\NOVO-Business-Centre`  
**New GitHub repository:** `NOVO-Business-Centre` (PRIVATE, account from `gh auth status`; final URL not assumed).  
**Remote older NOVO:** `https://github.com/novobusinesscenter/novo_business` is only a historic reference and must **not** be reused as `origin`.  
**Branch workflow:** `main` for bootstrap, then `codex/sprint-XX-topic` feature branches + PR/review.  
**Baseline:** `NOVO-Business-Centre-portable-2026-10-25.zip` only if destination folder is empty; otherwise audit existing files, never overwrite them.  

---

# NOVO × Asah 2026 — Codex Master Backlog

**Grup:** A26-CS225 | **Tanggal baseline:** 25 Oktober 2026

## Aturan pembuktian

- Sumber produk: PRD NOVO asli (FR dan NFR dipertahankan); PRD v4 adalah adendum bukan penghapusan.
- Checklist sumber resmi Asah: 20 Main Quest + 42 Side Quest. Semua diminta masuk roadmap; Side Quest tetap opsional menurut Dicoding.
- Status `unverified` berarti belum diverifikasi secara independen dari baseline ZIP; jangan tandai selesai tanpa bukti pengujian.
- Real-world data siswa/pelanggan/keuangan dilarang dalam demo tanpa izin; gunakan data sintetis.
- Jangan menggunakan ulang implementasi lama NOVO sebagai hasil kerja baru Capstone tanpa status/asal kontribusi yang jujur.
- Setelah tiap sprint, Codex harus memperbarui `docs/IMPLEMENTATION_STATUS.md`, `docs/QUEST-TRACEABILITY.md`, dan `docs/NOVO-PRD-COVERAGE.md` berdasarkan bukti.

## Urutan pengerjaan

| Tahap | Fokus | Referensi dan target |
|---|---|---|
| 01 | Baseline build, test, dan continuity tracker | Seluruh FR/NFR/quest dihitung dari sumber; periksa environment, lint/test/build/migrate; perbaiki blocker minimal; jangan tambah fitur bisnis. |
| 02 | Session & security foundation | FR-001, FR-002, NFR-003, NFR-004, SQ-06, SQ-10, SQ-11; cookie HttpOnly, revocation, role/tenant scope, CSRF, integration tests. |
| 03 | Master Data dan impor Excel | FR-003, FR-004, FR-005; template, preview validasi, upsert aman, keanggotaan valid, tidak pakai data riil. |
| 04 | SO Store end-to-end | FR-006; produk/kategori, stok/mutasi, kasir, HPP, void, kuitansi, kontrol finansial, tes. |
| 05 | SO Shuttle end-to-end | FR-007; subscriptions, billing, partial payment, vendor share, settlement, attachments, laporan. |
| 06 | SO Catering end-to-end | FR-009; vendor, paket, peserta, periode, fee, invoice, pembayaran, rekonsiliasi. |
| 07 | SO Funding end-to-end | FR-010; kategori, tabungan, ledger derived balance, restricted/event fund, refund, reconciliation. |
| 08 | SO Financing end-to-end | FR-011; PR, approval, procurement, actual HPP, markup, BAST, piutang, pembayaran, audit. |
| 09 | SO Purchasing extension | Alur khusus SO Purchasing sebagai extension; definisikan kebutuhan yang belum ada, jangan klaim source PRD. |
| 10 | Attachment dan backup/restore | FR-008, FR-014; object storage, entity permission, scan, restore rehearsal, encryption/retention. |
| 11 | Reporting Core & Data Science | FR-013, FU-01..06, DS checklist; SQ-29..36; dashboard, ETL, filters, data dictionary, contract. |
| 12 | Original AI training & evaluation | GE-01..06 (perhatikan GE-04 = kebijakan sumber data), SQ-17..20, SQ-35..41; model intent, 2 baseline, split/leakage, tuning, calibration. |
| 13 | FastAPI serving & prediction integration | GE-07, SQ-08, SQ-28, SQ-42; service online, auth, schema, failure fallback, ML inference. |
| 14 | Generative AI & RAG | GE-05, SQ-07, SQ-09, SQ-21..26; prompt, RAG, embedding, OOD tests >=10, provider failures, source attribution. |
| 15 | External messaging integration | SQ-27; sandbox WhatsApp/Telegram, consent, webhook signature, rate limits, no real secrets. |
| 16 | UX polish & collaboration evidence | SQ-01..05, SQ-12..15, SQ-33; responsive, Axios if required by checklist, history, documented contracts, user guide. |
| 17 | SIMS API sync | FR-012, NFR-002; versioned contract, safe sync and diff previews; stub if no authorized SIMS test endpoint. |
| 18 | Deployment, E2E, capstone evidence | FU-06, SQ-16; CI/CD, secure demo, mobile E2E, OpenAPI, docs, contributions; flag external dependencies. |
| 19 | 100% requirements reconciliation | Compare all 14 FR + 10 NFR + 20 Main Quest + 42 Side Quest; each status verified or block identified and no false passes. |

## FR NOVO (14)

- [ ] **FR-001** — Login/logout dan session persisten
- [ ] **FR-002** — Validasi role/permission & business-unit scope di server
- [ ] **FR-003** — CRUD Student/Teacher/Employee
- [ ] **FR-004** — Download template + impor Excel
- [ ] **FR-005** — Cooperative membership & eligibility
- [ ] **FR-006** — POS, inventory, payment, receipt, history, stock movement
- [ ] **FR-007** — Subscription, billing, payment, settlement, reporting
- [ ] **FR-008** — Upload/download persisten terotorisasi
- [ ] **FR-009** — Vendor, paket, peserta, fee, invoice, payment, rekonsiliasi
- [ ] **FR-010** — Kategori/akun/tabungan, ledger, saldo, restricted fund
- [ ] **FR-011** — PR, approval, procurement, HPP, BAST, receivable, payment
- [ ] **FR-012** — Sinkronisasi master data melalui API
- [ ] **FR-013** — Laporan lintas unit dari data persisten
- [ ] **FR-014** — Backup/restore data & attachment

## NFR NOVO (10)

- [ ] **NFR-001** — Data production tetap setelah restart/redeploy
- [ ] **NFR-002** — NOVO tetap bekerja dengan data hasil sinkronisasi saat SIMS tidak tersedia
- [ ] **NFR-003** — Cegah privilege escalation melalui header/client
- [ ] **NFR-004** — Histori transaksi & perubahan penting terlacak
- [ ] **NFR-005** — Tidak ada blank screen; error/empty/denied state
- [ ] **NFR-006** — Kasir/list utama responsif
- [ ] **NFR-007** — Domain modular, kontrak jelas
- [ ] **NFR-008** — Deploy VPS sekolah dengan lingkungan terpisah
- [ ] **NFR-009** — DB dan lampiran memiliki prosedur backup/restore
- [ ] **NFR-010** — Akses desktop/laptop dan navigasi mobile tak rusak

## Main Quest resmi Asah (20)

- [ ] **FU-01** — Menyelesaikan satu masalah UMKM yang jelas untuk pengguna yang spesifik.
- [ ] **FU-02** — Memiliki minimal 2 fitur utama yang menjawab masalah tersebut.
- [ ] **FU-03** — Memberikan hasil yang sesuai dengan aksi atau input pengguna.
- [ ] **FU-04** — Memberi tanda yang jelas saat aksi berhasil, gagal, atau sedang diproses.
- [ ] **FU-05** — Mudah digunakan pelaku UMKM dengan panduan yang jelas.
- [ ] **FU-06** — Dapat diakses publik secara online melalui browser, termasuk di ponsel.
- [ ] **GE-01** — Menjelaskan permasalahan yang mau diselesaikan oleh model yang akan dibuat di README
- [ ] **GE-02** — Membangun model AI yang disesuaikan dengan keadaan data yang disediakan oleh tim Data Science.
- [ ] **GE-03** — Menerapkan tahapan preprocessing data sebelum digunakan oleh model AI.
- [ ] **GE-04** — Diperbolehkan menggunakan API data publik, sumber data, dataset, library, maupun data pribadi apa pun, dengan mencantumkan sumber setiap item yang digunakan di README.
- [ ] **GE-05** — Membangun fitur tambahan generatif AI yang memanfaatkan API model proprietary seperti ChatGPT, Gemini, dll.
- [ ] **GE-06** — Membandingkan minimal 2 model atau konfigurasi dengan metrik yang sama, lalu menuliskan tabel perbandingan dan alasan pemilihan model terbaik di README.
- [ ] **GE-07** — Bekerja sama dengan anggota tim dari Full-stack dalam mengembangkan REST API menggunakan FastAPI atau Flask untuk melakukan serving model AI yang dapat diakses secara online oleh back-end aplikasi.
- [ ] **DA-01** — Mengidentifikasi dan menganalisis bersama tim masalah UMKM yang akan diselesaikan dan menjelaskan peran data dalam solusi tersebut.
- [ ] **DA-02** — Merumuskan pertanyaan bisnis yang dapat dijawab melalui analisis data.
- [ ] **DA-03** — Melakukan seluruh tahapan pengolahan data (data wrangling).
- [ ] **DA-04** — Mengolah dan menganalisis data untuk menjawab pertanyaan bisnis, disertai penjelasan proses dan hasilnya.
- [ ] **DA-05** — Menyajikan temuan dan rekomendasi yang mudah dipahami serta relevan dengan solusi tim.
- [ ] **DA-06** — Menyediakan data atau hasil analisis dalam bentuk yang dapat digunakan oleh anggota tim lain, disertai penjelasan cara penggunaannya.
- [ ] **DA-07** — Memeriksa ketepatan data dan hasil analisis sebelum digunakan dalam solusi akhir.

## Side Quest resmi Asah (42)

- [ ] **SQ-01** — Front-end dan Back-end dibangun terpisah (decoupled) dan saling terhubung memalui networking call
- [ ] **SQ-02** — Front-end dibangun dengan module bundler (seperti Vite atau Webpack)
- [ ] **SQ-03** — Back-end dibangun dengan Express dan URL API sesuai konvensi (misal: /api/v1/resource)
- [ ] **SQ-04** — Antarmuka menggunakan CSS framework dan UI component modern
- [ ] **SQ-05** — Networking calls menggunakan Axios
- [ ] **SQ-06** — Data tersimpan secara persisten.
- [ ] **SQ-07** — Layanan Gen AI diakses melalui Backend, bukan langsung dari Frontend.
- [ ] **SQ-08** — Hasil tim Data Science (dasbor, prediksi, atau rekomendasi) tampil pada fitur yang relevan.
- [ ] **SQ-09** — Riwayat hasil layanan Gen AI tersimpan di database.
- [ ] **SQ-10** — Backend memvalidasi data menggunakan schema validation (seperti Joi).
- [ ] **SQ-11** — Menangani kegagalan aplikasi maupun layanan Gen AI dan Data Science dengan pesan yang jelas.
- [ ] **SQ-12** — Mockup dibuat sebelum pengembangan.
- [ ] **SQ-13** — Antarmuka responsif dengan keputusan desain yang jelas, bukan sekadar mengikuti template umum.
- [ ] **SQ-14** — Riwayat kode dikelola dengan Git dan GitHub (atau layanan sejenis).
- [ ] **SQ-15** — Kontrak API atau format data disepakati dengan tim Gen AI dan Data Science sebelum pengembangan.
- [ ] **SQ-16** — Aplikasi di-deploy ke layanan gratis atau free tier (seperti Netlify, Render, Neon, atau Cloudflare Pages).
- [ ] **SQ-17** — Memeriksa keseimbangan jumlah data antarkelas pada dataset dari tim Data Science dan menanganinya JIKA tidak seimbang, lalu menjelaskan penanganannya di README.
- [ ] **SQ-18** — Menerapkan teknik untuk meningkatkan kinerja model, seperti augmentasi data atau penyetelan hyperparameter, lalu menuliskan pengaruhnya terhadap hasil model di README.
- [ ] **SQ-19** — Menguji model menggunakan data uji yang disisihkan dengan metrik yang sesuai dengan jenis tugasnya, seperti F1-score untuk klasifikasi atau precision@k untuk rekomendasi, lalu menuliskan hasilnya di README.
- [ ] **SQ-20** — Melatih model tambahan yang melengkapi solusi, misalnya model klasifikasi sentimen ulasan pelanggan dengan minimal 2 kelas, yaitu positif dan negatif. Hasilnya dapat ditampilkan di aplikasi web tim atau di dasbor tim Data Science.
- [ ] **SQ-21** — Membangun sistem RAG yang terdiri dari model generation (API proprietary atau SLM/LLM open-source yang di-host lokal), model embedding, dan vector database (ChromaDB, FAISS, Pinecone, Weaviate).
- [ ] **SQ-22** — Menjadikan model AI yang dilatih di Main Quest sebagai model klasifikasi intent dengan minimal 4 intent, seperti tanya produk, pemesanan, keluhan, dan lainnya. Hasil klasifikasi dipakai untuk mengarahkan pertanyaan ke alur yang sesuai, misalnya pertanyaan produk dijawab oleh sistem RAG dan keluhan diteruskan ke pemilik usaha.
- [ ] **SQ-23** — Menyusun prompt terstruktur (template, few-shot) agar hasil konsisten dengan gaya bahasa usaha.
- [ ] **SQ-24** — Membatasi chatbot agar menolak pertanyaan di luar konteks usaha dengan sopan, lalu mengujinya menggunakan minimal 10 pertanyaan di luar konteks dan menuliskan hasilnya di README.
- [ ] **SQ-25** — Menyepakati kontrak API bersama tim Full-stack, meliputi endpoint, format request/response, dan kode error, sebelum pengembangan dimulai.
- [ ] **SQ-26** — Menangani input yang tidak valid dan kegagalan layanan AI, termasuk saat API model generatif lambat atau mencapai batas kuota gratis, dengan pesan yang jelas bagi pengguna.
- [ ] **SQ-27** — Mengintegrasikan solusi ke kanal yang dipakai UMKM, seperti Telegram atau WhatsApp. Untuk WhatsApp, tim dapat menggunakan nomor uji gratis dari WhatsApp Cloud API.
- [ ] **SQ-28** — Menyediakan dokumentasi API yang dapat dicoba langsung, seperti Swagger atau OpenAPI.
- [ ] **SQ-29** — Mengembangkan dasbor interaktif menggunakan Streamlit atau teknologi visualisasi lain yang sesuai.
- [ ] **SQ-30** — Menampilkan indikator bisnis dan menyediakan filter yang relevan untuk membantu pengguna memahami kondisi bisnis.
- [ ] **SQ-31** — Menyediakan pembaruan data melalui unggahan file atau koneksi ke sumber data.
- [ ] **SQ-32** — Memprioritaskan penggunaan data primer yang diperoleh langsung dari UMKM. Jika data primer tidak tersedia atau belum mencukupi, boleh menggunakan data dummy atau data publik yang sesuai dengan karakteristik data asli.
- [ ] **SQ-33** — Mengintegrasikan dasbor ke aplikasi web bersama tim Full-stack.
- [ ] **SQ-34** — Menyepakati kebutuhan dan format data bersama tim Gen AI. Jika data primer tidak mencukupi, boleh menggunakan  data dummy atau data publik. Penggunaan data dummy atau data publik harus diberi label yang jelas, disertai penjelasan sumber atau cara pembuatannya serta keterbatasan penggunaannya.
- [ ] **SQ-35** — Melakukan pelabelan, transformasi, atau feature engineering sesuai kebutuhan model.
- [ ] **SQ-36** — Menyusun kamus data (data dictionary) atau penjelasan isi dataset agar mudah digunakan.
- [ ] **SQ-37** — Menyiapkan pembagian data yang sesuai untuk training dan testing model serta mencegah kebocoran data.
- [ ] **SQ-38** — Mengembangkan model classification, regression, forecasting, dan model lain yang sesuai kebutuhan fitur.
- [ ] **SQ-39** — Melakukan feature engineering  dan mengevaluasi pengaruhnya terhadap kinerja model.
- [ ] **SQ-40** — Menguji model pada data yang tidak digunakan untuk training dengan pembagian data dan metrik evaluasi yang sesuai.
- [ ] **SQ-41** — Membandingkan hasil model dan menjelaskan keterbatasannya jika menguji lebih dari satu model.
- [ ] **SQ-42** — Mengintegrasikan hasil prediksi ke aplikasi web bersama tim Full-stack.

## Aturan checkpoint untuk sesi Codex berlimit

Sebelum akhir setiap sesi, Codex menuliskan `docs/CODEX_HANDOFF.md` dengan:
1. Commit hash/branch terakhir dan file diubah.
2. Butir FR/NFR/Main/Side yang benar-benar dikerjakan + status `done/partial/blocked/not-started`.
3. Perintah dan output tes yang dijalankan secara nyata, beserta kegagalan.
4. Dependensi/secret yang dibutuhkan tanpa membocorkan nilainya.
5. Tepat satu next task yang kecil dan dapat diuji.
6. Jika tanpa Git remote: ekspor ZIP yang diuji ekstraksinya, tanpa node_modules atau kredensial.

Jangan pernah melakukan centang status dari dugaan atau dari keberadaan source saja.

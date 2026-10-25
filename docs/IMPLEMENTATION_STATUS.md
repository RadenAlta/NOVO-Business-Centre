# Sprint 01 — Implementation Status

**Audit date:** 25 October 2026
**Branch:** `codex/sprint-01-foundation`
**Audit boundary:** source-level review plus commands actually attempted in this workspace. This is not a claim that the capstone is finished or that any unexecuted feature works.

## Status convention

Only four statuses are used: `not-started`, `partial`, `verified`, and `blocked`. `verified` requires an observed working behavior and a documented passing test. No requirement is marked `verified` in this sprint because the runtime checks below could not complete in this environment.

| Status | Count | Meaning in this audit |
| --- | ---: | --- |
| verified | 0 | Executed behavior and passing test observed |
| partial | 70 | Source or limited implementation observed, but behavior is not fully verified |
| blocked | 6 | Required environment/deployment/runtime proof unavailable |
| not-started | 10 | No qualifying implementation/evidence observed |
| **Total** | **86** | **14 FR + 10 NFR + 20 Main Quest + 42 Side Quest** |

## Functional requirements (14)

| ID | Area/track | Requirement | Status | Audit evidence / blocker |
| --- | --- | --- | --- | --- |
| FR-001 | Authentication | Login/logout dan session persisten | partial | Static audit: JWT login, cookie and sessionStorage bearer exist; no executed auth flow test. |
| FR-002 | RBAC | Validasi role/permission & business-unit scope di server | partial | Static audit: authenticate reloads active user and tenant; requireRoles is present; negative tests absent. |
| FR-003 | Master Data | CRUD Student/Teacher/Employee | partial | Static audit: `apps/api/src/app.ts` master-data CRUD/active-state routes and `apps/web/src/pages.tsx` MasterDataPage exist; no API integration test. |
| FR-004 | Master Data Excel | Download template + impor Excel | not-started | No Excel template/download/import endpoint, parser, or web flow was found in `apps/api/src` or `apps/web/src`. |
| FR-005 | Membership | Cooperative membership & eligibility | partial | Static audit: `app.ts` `/members` routes enforce teacher/employee eligibility and use `CooperativeMember`; no API integration test. |
| FR-006 | SO Store | POS, inventory, payment, receipt, history, stock movement | partial | Static audit: `app.ts` product, stock-adjustment and transactional `/sales` routes plus Store screen exist; no POS integration test. |
| FR-007 | SO Shuttle | Subscription, billing, payment, settlement, reporting | partial | Static audit: `app.ts` shuttle route, subscription, invoice and payment routes exist; no billing/settlement integration test. |
| FR-008 | Attachments | Upload/download persisten terotorisasi | partial | Static audit: `app.ts` attachment upload/signature/hash and tenant-scoped download paths exist; no storage integration test. |
| FR-009 | SO Catering | Vendor, paket, peserta, fee, invoice, payment, rekonsiliasi | partial | Static audit: `app.ts` catering order creation/status paths and CateringPage exist; vendor/package/reconciliation flows remain incomplete. |
| FR-010 | SO Funding | Kategori/akun/tabungan, ledger, saldo, restricted fund | partial | Static audit: `app.ts` savings-account and append-only ledger-entry routes exist; category/restricted-fund/reconciliation flows remain incomplete. |
| FR-011 | SO Financing | PR, approval, procurement, HPP, BAST, receivable, payment | partial | Static audit: `app.ts` financing application/receivable routes and FinancingPage exist; procurement/HPP/BAST lifecycle remains incomplete. |
| FR-012 | SIMS API | Sinkronisasi master data melalui API | not-started | No SIMS sync adapter or sync-failure test was observed in this audit. |
| FR-013 | Reporting Core | Laporan lintas unit dari data persisten | partial | Static audit: `app.ts` dashboard aggregation and the reporting/dashboard surfaces exist; no persistent-data reporting test. |
| FR-014 | Backup/Restore | Backup/restore data & attachment | not-started | No executed backup/restore drill or evidence was found. |

## Non-functional requirements (10)

| ID | Area/track | Requirement | Status | Audit evidence / blocker |
| --- | --- | --- | --- | --- |
| NFR-001 | Persistence | Data production tetap setelah restart/redeploy | blocked | Blocked: no PostgreSQL/Docker runtime available to prove persistence after restart. |
| NFR-002 | Availability | NOVO tetap bekerja dengan data hasil sinkronisasi saat SIMS tidak tersedia | not-started | No offline/SIMS-unavailable graceful-degradation test observed. |
| NFR-003 | Security | Cegah privilege escalation melalui header/client | partial | Static tenant and active-user checks observed; isolation/RBAC negative tests not run. |
| NFR-004 | Auditability | Histori transaksi & perubahan penting terlacak | partial | Static audit: `apps/api/src/audit.ts`, AuditLog schema and mutation audit calls exist; no persistence/query audit test. |
| NFR-005 | Usability | Tidak ada blank screen; error/empty/denied state | partial | Static validation/error envelopes and UI message paths observed; end-to-end usability test absent. |
| NFR-006 | Performance | Kasir/list utama responsif | blocked | Blocked: no load/performance environment or measurement was available. |
| NFR-007 | Maintainability | Domain modular, kontrak jelas | partial | Static layers are separated; build/typecheck is blocked by sandbox package-store limitation. |
| NFR-008 | Deployability | Deploy VPS sekolah dengan lingkungan terpisah | blocked | Blocked: no deployed environment, monitoring or recovery exercise was available. |
| NFR-009 | Backup | DB dan lampiran memiliki prosedur backup/restore | not-started | No database-and-attachment backup/restore procedure, script, or drill was observed. |
| NFR-010 | Browser | Akses desktop/laptop dan navigasi mobile tak rusak | partial | Static audit: responsive navigation/layout source exists in `apps/web/src/App.tsx` and `styles.css`; no browser/device test. |

## Main Quest (20)

| ID | Area/track | Requirement | Status | Audit evidence / blocker |
| --- | --- | --- | --- | --- |
| FU-01 | Full-Stack | Menyelesaikan satu masalah UMKM yang jelas untuk pengguna yang spesifik. | partial | Static documentation/source maps NOVO to cooperative business-centre workflows. |
| FU-02 | Full-Stack | Memiliki minimal 2 fitur utama yang menjawab masalah tersebut. | partial | Static audit observes several core business modules, not runtime-verified. |
| FU-03 | Full-Stack | Memberikan hasil yang sesuai dengan aksi atau input pengguna. | partial | Source mutations and form flows are present; browser result state was not exercised. |
| FU-04 | Full-Stack | Memberi tanda yang jelas saat aksi berhasil, gagal, atau sedang diproses. | partial | Static loading/error UI patterns observed; no browser usability verification. |
| FU-05 | Full-Stack | Mudah digunakan pelaku UMKM dengan panduan yang jelas. | partial | README and labeled screens exist; no independent usability test. |
| FU-06 | Full-Stack | Dapat diakses publik secara online melalui browser, termasuk di ponsel. | blocked | Blocked: no public deployment is configured or testable in this workspace. |
| GE-01 | Gen AI | Menjelaskan permasalahan yang mau diselesaikan oleh model yang akan dibuat di README | partial | README/data-problem documentation exists; model-problem narrative was not independently reviewed. |
| GE-02 | Gen AI | Membangun model AI yang disesuaikan dengan keadaan data yang disediakan oleh tim Data Science. | partial | Original TF-IDF classifier training code exists; training was not executed in this environment. |
| GE-03 | Gen AI | Menerapkan tahapan preprocessing data sebelum digunakan oleh model AI. | partial | Static preprocessing via TF-IDF/validation observed; no training execution proof. |
| GE-04 | Gen AI | Diperbolehkan menggunakan API data publik, sumber data, dataset, library, maupun data pribadi apa pun, dengan mencantumkan sumber setiap item yang digunakan di README. | partial | Synthetic corpus/source documentation exists; source/runtime evaluation not run. |
| GE-05 | Gen AI | Membangun fitur tambahan generatif AI yang memanfaatkan API model proprietary seperti ChatGPT, Gemini, dll. | partial | Optional provider-based assistant code exists; provider/key path not configured. |
| GE-06 | Gen AI | Membandingkan minimal 2 model atau konfigurasi dengan metrik yang sama, lalu menuliskan tabel perbandingan dan alasan pemilihan model terbaik di README. | partial | Logistic Regression versus LinearSVC evaluation code exists; results not regenerated. |
| GE-07 | Gen AI | Bekerja sama dengan anggota tim dari Full-stack dalam mengembangkan REST API menggunakan FastAPI atau Flask untuk melakukan serving model AI yang dapat diakses secara online oleh back-end aplikasi. | partial | FastAPI endpoints exist in `services/ml/app/main.py`; `compileall` passed on 25 October 2026, but service runtime is unverified because dependencies are not installed locally. |
| DA-01 | Data Science | Mengidentifikasi dan menganalisis bersama tim masalah UMKM yang akan diselesaikan dan menjelaskan peran data dalam solusi tersebut. | partial | Data-problem documentation and dashboard code exist; no dashboard runtime. |
| DA-02 | Data Science | Merumuskan pertanyaan bisnis yang dapat dijawab melalui analisis data. | partial | Static KPIs/questions observed in dashboard/source documentation. |
| DA-03 | Data Science | Melakukan seluruh tahapan pengolahan data (data wrangling). | partial | CSV validation and transformations are present in source; unexecuted. |
| DA-04 | Data Science | Mengolah dan menganalisis data untuk menjawab pertanyaan bisnis, disertai penjelasan proses dan hasilnya. | partial | Dashboard computations and filters are present in source; unexecuted. |
| DA-05 | Data Science | Menyajikan temuan dan rekomendasi yang mudah dipahami serta relevan dengan solusi tim. | partial | Static indicators exist; no observed finding/recommendation based on a real run. |
| DA-06 | Data Science | Menyediakan data atau hasil analisis dalam bentuk yang dapat digunakan oleh anggota tim lain, disertai penjelasan cara penggunaannya. | partial | CSV upload/dashboard sharing surface exists; no hosted or runtime proof. |
| DA-07 | Data Science | Memeriksa ketepatan data dan hasil analisis sebelum digunakan dalam solusi akhir. | partial | Input validation/source disclosure exists; no data-quality verification execution. |

## Side Quest (42)

| ID | Area/track | Requirement | Status | Audit evidence / blocker |
| --- | --- | --- | --- | --- |
| SQ-01 | Full-Stack | Front-end dan Back-end dibangun terpisah (decoupled) dan saling terhubung memalui networking call | partial | Vite web and Express API are distinct packages with network client source. |
| SQ-02 | Full-Stack | Front-end dibangun dengan module bundler (seperti Vite atau Webpack) | partial | Vite configuration/package is present; production build did not run. |
| SQ-03 | Full-Stack | Back-end dibangun dengan Express dan URL API sesuai konvensi (misal: /api/v1/resource) | partial | Express API uses /api/v1 route surface in source. |
| SQ-04 | Full-Stack | Antarmuka menggunakan CSS framework dan UI component modern | partial | Responsive CSS/UI source exists; visual browser review not run. |
| SQ-05 | Full-Stack | Networking calls menggunakan Axios | not-started | Client uses native fetch rather than the checklist's Axios target. |
| SQ-06 | Full-Stack | Data tersimpan secara persisten. | blocked | Blocked: Prisma/PostgreSQL persistence cannot be verified without a DB runtime. |
| SQ-07 | Full-Stack | Layanan Gen AI diakses melalui Backend, bukan langsung dari Frontend. | partial | Server-side AI route code exists; provider integration not configured/executed. |
| SQ-08 | Full-Stack | Hasil tim Data Science (dasbor, prediksi, atau rekomendasi) tampil pada fitur yang relevan. | partial | Demand-prediction integration source exists; no running ML/API proof. |
| SQ-09 | Full-Stack | Riwayat hasil layanan Gen AI tersimpan di database. | partial | AiInteraction persistence model/path exists; migration/runtime unverified. |
| SQ-10 | Full-Stack | Backend memvalidasi data menggunakan schema validation (seperti Joi). | partial | Zod request validation is present in backend source. |
| SQ-11 | Full-Stack | Menangani kegagalan aplikasi maupun layanan Gen AI dan Data Science dengan pesan yang jelas. | partial | Error envelope and UI messages observed statically; failure journey untested. |
| SQ-12 | Full-Stack | Mockup dibuat sebelum pengembangan. | not-started | No pre-development mockup evidence is asserted. |
| SQ-13 | Full-Stack | Antarmuka responsif dengan keputusan desain yang jelas, bukan sekadar mengikuti template umum. | partial | Responsive breakpoints/source patterns observed; no device test. |
| SQ-14 | Full-Stack | Riwayat kode dikelola dengan Git dan GitHub (atau layanan sejenis). | partial | Git history and branch exist; remote PR/push from this runtime remains unverified. |
| SQ-15 | Full-Stack | Kontrak API atau format data disepakati dengan tim Gen AI dan Data Science sebelum pengembangan. | partial | Written API contract exists; no independent agreement record. |
| SQ-16 | Full-Stack | Aplikasi di-deploy ke layanan gratis atau free tier (seperti Netlify, Render, Neon, atau Cloudflare Pages). | blocked | Blocked: no free-tier deployment is available to verify. |
| SQ-17 | Gen AI | Memeriksa keseimbangan jumlah data antarkelas pada dataset dari tim Data Science dan menanganinya JIKA tidak seimbang, lalu menjelaskan penanganannya di README. | partial | Synthetic intent corpus/class-balance logic exists; training not executed. |
| SQ-18 | Gen AI | Menerapkan teknik untuk meningkatkan kinerja model, seperti augmentasi data atau penyetelan hyperparameter, lalu menuliskan pengaruhnya terhadap hasil model di README. | not-started | No tuning experiment or comparison evidence was observed. |
| SQ-19 | Gen AI | Menguji model menggunakan data uji yang disisihkan dengan metrik yang sesuai dengan jenis tugasnya, seperti F1-score untuk klasifikasi atau precision@k untuk rekomendasi, lalu menuliskan hasilnya di README. | partial | Held-out metric code exists; metrics not regenerated in this sprint. |
| SQ-20 | Gen AI | Melatih model tambahan yang melengkapi solusi, misalnya model klasifikasi sentimen ulasan pelanggan dengan minimal 2 kelas, yaitu positif dan negatif. Hasilnya dapat ditampilkan di aplikasi web tim atau di dasbor tim Data Science. | partial | Demand regressor complements intent classifier in source. |
| SQ-21 | Gen AI | Membangun sistem RAG yang terdiri dari model generation (API proprietary atau SLM/LLM open-source yang di-host lokal), model embedding, dan vector database (ChromaDB, FAISS, Pinecone, Weaviate). | partial | RAG/vector-db source and lightweight fallback tests exist; pytest and the full embedding smoke path remain unverified. |
| SQ-22 | Gen AI | Menjadikan model AI yang dilatih di Main Quest sebagai model klasifikasi intent dengan minimal 4 intent, seperti tanya produk, pemesanan, keluhan, dan lainnya. Hasil klasifikasi dipakai untuk mengarahkan pertanyaan ke alur yang sesuai, misalnya pertanyaan produk dijawab oleh sistem RAG dan keluhan diteruskan ke pemilik usaha. | partial | At least four intent routes are present in source; endpoint untested. |
| SQ-23 | Gen AI | Menyusun prompt terstruktur (template, few-shot) agar hasil konsisten dengan gaya bahasa usaha. | partial | Structured prompt construction is present in server-side AI code. |
| SQ-24 | Gen AI | Membatasi chatbot agar menolak pertanyaan di luar konteks usaha dengan sopan, lalu mengujinya menggunakan minimal 10 pertanyaan di luar konteks dan menuliskan hasilnya di README. | not-started | No ten-question out-of-scope/refusal test suite observed. |
| SQ-25 | Gen AI | Menyepakati kontrak API bersama tim Full-stack, meliputi endpoint, format request/response, dan kode error, sebelum pengembangan dimulai. | partial | Written API contract exists; no independent agreement record. |
| SQ-26 | Gen AI | Menangani input yang tidak valid dan kegagalan layanan AI, termasuk saat API model generatif lambat atau mencapai batas kuota gratis, dengan pesan yang jelas bagi pengguna. | partial | Validation/provider-error handling is present statically; not executed. |
| SQ-27 | Gen AI | Mengintegrasikan solusi ke kanal yang dipakai UMKM, seperti Telegram atau WhatsApp. Untuk WhatsApp, tim dapat menggunakan nomor uji gratis dari WhatsApp Cloud API. | not-started | No WhatsApp or Telegram channel integration observed. |
| SQ-28 | Gen AI | Menyediakan dokumentasi API yang dapat dicoba langsung, seperti Swagger atau OpenAPI. | partial | FastAPI `/docs` route exists and ML source compiles; service startup remains unverified because dependencies are unavailable locally. |
| SQ-29 | Data Science | Mengembangkan dasbor interaktif menggunakan Streamlit atau teknologi visualisasi lain yang sesuai. | partial | Streamlit dashboard source exists; not executed. |
| SQ-30 | Data Science | Menampilkan indikator bisnis dan menyediakan filter yang relevan untuk membantu pengguna memahami kondisi bisnis. | partial | Dashboard KPI/filter source exists; not executed. |
| SQ-31 | Data Science | Menyediakan pembaruan data melalui unggahan file atau koneksi ke sumber data. | partial | CSV refresh/upload source exists; not executed. |
| SQ-32 | Data Science | Memprioritaskan penggunaan data primer yang diperoleh langsung dari UMKM. Jika data primer tidak tersedia atau belum mencukupi, boleh menggunakan data dummy atau data publik yang sesuai dengan karakteristik data asli. | partial | Synthetic data labeling/source-selection patterns exist in source. |
| SQ-33 | Data Science | Mengintegrasikan dasbor ke aplikasi web bersama tim Full-stack. | partial | Web dashboard link/integration code exists; no authenticated runtime check. |
| SQ-34 | Data Science | Menyepakati kebutuhan dan format data bersama tim Gen AI. Jika data primer tidak mencukupi, boleh menggunakan  data dummy atau data publik. Penggunaan data dummy atau data publik harus diberi label yang jelas, disertai penjelasan sumber atau cara pembuatannya serta keterbatasan penggunaannya. | partial | Data dictionary/contract exists; no independent agreement record. |
| SQ-35 | Data Science | Melakukan pelabelan, transformasi, atau feature engineering sesuai kebutuhan model. | partial | Labeling/features code exists; no executed data pipeline. |
| SQ-36 | Data Science | Menyusun kamus data (data dictionary) atau penjelasan isi dataset agar mudah digunakan. | partial | Dashboard data dictionary exists in repository. |
| SQ-37 | Data Science | Menyiapkan pembagian data yang sesuai untuk training dan testing model serta mencegah kebocoran data. | partial | Train/test split logic exists; training did not execute. |
| SQ-38 | Data Science | Mengembangkan model classification, regression, forecasting, dan model lain yang sesuai kebutuhan fitur. | partial | Prediction model selection is present in source; unverified at runtime. |
| SQ-39 | Data Science | Melakukan feature engineering  dan mengevaluasi pengaruhnya terhadap kinerja model. | partial | Feature engineering exists; no ablation/performance-effect proof. |
| SQ-40 | Data Science | Menguji model pada data yang tidak digunakan untuk training dengan pembagian data dan metrik evaluasi yang sesuai. | partial | Unseen-test evaluation code exists; no fresh evaluation result. |
| SQ-41 | Data Science | Membandingkan hasil model dan menjelaskan keterbatasannya jika menguji lebih dari satu model. | partial | Two-model comparison and caveat code exists; execution is unverified. |
| SQ-42 | Data Science | Mengintegrasikan hasil prediksi ke aplikasi web bersama tim Full-stack. | partial | Prediction web card/proxy source exists; integration untested. |

## Commands actually attempted

| Command | Observed result | Status |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | pnpm project-store symlink creation failed with `EPERM` / exit `-4048` in this desktop sandbox. | blocked by environment |
| `pnpm db:generate` | Stopped by the same pnpm symlink preflight. | blocked by environment |
| `pnpm build` | Stopped by the same pnpm symlink preflight. | blocked by environment |
| `pnpm test` | Stopped by the same pnpm symlink preflight. | blocked by environment |
| `pnpm lint` | Stopped by the same pnpm symlink preflight. | blocked by environment |
| Bundled Python: `-m compileall services/ml/app services/ml/tests` | PASS (exit 0); all ML modules and both test files compiled on 25 October 2026. | syntax only |
| Bundled Python: `-m pytest -q` in `services/ml` | BLOCKED (exit 1): bundled runtime has no `pytest`; ML dependencies were not installed locally. | blocked by environment |
| `docker compose config` | Docker command was not installed/available. | blocked by environment |
| Prisma schema validation / dev migration | Cannot run without installed dependencies and a PostgreSQL/Docker runtime. | blocked by environment |
| Git staging/commit in Codex | git add could not create .git/index.lock (Permission denied). | blocked by environment |
| gh pr checks 1 / gh run list | Current Codex environment could not connect to pi.github.com (exit 1); no new remote status retrieved. | blocked by environment |

## Static security audit

- `apps/api/src/auth.ts` reloads the account from the database and checks tenant/active state; `requireRoles` is applied by protected routes. This is promising source evidence, not a negative authorization test.
- The login response still gives the browser a bearer token and `apps/web/src/auth.tsx` keeps it in `sessionStorage`. An XSS issue could expose that token.
- Logout clears the cookie but there is no server-side session store or token revocation; a copied bearer remains usable until expiry, subject to active-account checks.
- Cookie-authenticated state-changing calls have no CSRF token or explicit origin check beyond cookie settings/CORS. Production hardening remains required.

## Reproduce outside this sandbox

Run the commands in a normal local PowerShell/CI environment with Node 24, pnpm 11, Python 3.11 and Docker Desktop, then replace only the rows supported by observed results with `verified` and cite the exact test/command.

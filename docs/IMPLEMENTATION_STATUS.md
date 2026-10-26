# Sprint 03 — Master Data, Excel Import & Membership Status

**Audit date:** 26 October 2026
**Branch:** `codex/sprint-03-master-data-import`
**Audit boundary:** final source audit at branch head `16824cc` against `main` `671f049`, local validation on 26 October 2026, and owner-reported successful GitHub Actions run `40301187864`. The hosted API/Web job uses disposable PostgreSQL, applies committed migrations, then runs build, all workspace tests, and lint. This is not full browser E2E, production deployment, or security certification.

## Status convention

Only four statuses are used: `not-started`, `partial`, `verified`, and `blocked`. `verified` requires an observed working behavior and a documented passing test. No end-to-end product requirement is marked `verified` in this sprint: the owner-reported CI passed, but it does not establish complete runtime behavior for each requirement.

| Status | Count | Meaning in this audit |
| --- | ---: | --- |
| verified | 0 | Executed behavior and passing test observed |
| partial | 71 | Source or limited implementation observed, but behavior is not fully verified |
| blocked | 6 | Required environment/deployment/runtime proof unavailable |
| not-started | 9 | No qualifying implementation/evidence observed |
| **Total** | **86** | **14 FR + 10 NFR + 20 Main Quest + 42 Side Quest** |

## Functional requirements (14)

| ID | Area/track | Requirement | Status | Audit evidence / blocker |
| --- | --- | --- | --- | --- |
| FR-001 | Authentication | Login/logout dan session persisten | partial | Hosted PostgreSQL security tests passed in CI for opaque 256-bit HttpOnly cookie, stable CSRF, session hashing, expiry/revocation and replay; browser E2E and production configuration remain unverified. |
| FR-002 | RBAC | Validasi role/permission & business-unit scope di server | partial | Hosted PostgreSQL tests passed current-role, inactive-account and cross-tenant negative cases; full business-unit permission matrix and production threat review remain unverified. |
| FR-003 | Master Data | CRUD Student/Teacher/Employee | partial | Tenant-scoped CRUD/status/search/filter/pagination plus identifier normalization and SIMS protection are implemented. Hosted CI covered its PostgreSQL security scenarios; browser E2E remains unverified. |
| FR-004 | Master Data Excel | Download template + impor Excel | partial | Exact XLSX template, ZIP/formula safeguards, actor/tenant-bound expiry, serializable one-use commit and concurrency tests are implemented. Raw XLSX bytes are not persisted; structured-preview cleanup remains a documented follow-up. |
| FR-005 | Membership | Cooperative membership & eligibility | partial | Creation and reactivation require an active same-tenant teacher or employee; students, inactive/foreign identities and duplicates are denied. Status changes are admin-only, CSRF-protected and audited. Legacy unlinked members remain historical but ineligible. |
| FR-006 | SO Store | POS, inventory, payment, receipt, history, stock movement | partial | Static audit: `app.ts` product, stock-adjustment and transactional `/sales` routes plus Store screen exist; no POS integration test. |
| FR-007 | SO Shuttle | Subscription, billing, payment, settlement, reporting | partial | Static audit: `app.ts` shuttle route, subscription, invoice and payment routes exist; no billing/settlement integration test. |
| FR-008 | Attachments | Upload/download persisten terotorisasi | partial | CI integration suite exercised a credentialed CSRF/origin-protected multipart upload; signature/hash and tenant-scoped download source exists. Production object storage, malware scanning, and end-to-end authorization remain unverified. |
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
| NFR-003 | Security | Cegah privilege escalation melalui header/client | partial | Source rejects bearer-only/altered/revoked/expired sessions, checks fresh role/account/tenant state, uses stable CSRF/origin enforcement, scopes/removes React Query cache per principal, and retains UI state on unconfirmed logout. Disposable PostgreSQL migration/integration checks passed on hosted CI; browser E2E and production threat review remain pending. |
| NFR-004 | Auditability | Histori transaksi & perubahan penting terlacak | partial | Static audit: `apps/api/src/audit.ts`, AuditLog schema and mutation audit calls exist; no persistence/query audit test. |
| NFR-005 | Usability | Tidak ada blank screen; error/empty/denied state | partial | Static validation/error envelopes and UI message paths observed; end-to-end usability test absent. |
| NFR-006 | Performance | Kasir/list utama responsif | blocked | Blocked: no load/performance environment or measurement was available. |
| NFR-007 | Maintainability | Domain modular, kontrak jelas | partial | Static layers are separated; GitHub CI monorepo build passed on `91b0a23`, while local sandbox installation and broader maintainability verification remain blocked. |
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
| SQ-01 | Full-Stack | Front-end dan Back-end dibangun terpisah (decoupled) dan saling terhubung memalui networking call | partial | Vite client and Express API remain separate; credentialed cookie fetch includes cancellation signals, protected cache keys include tenant/user/role, and cache removal occurs on account change/unauthentication. Browser end-to-end flow remains unverified. |
| SQ-02 | Full-Stack | Front-end dibangun dengan module bundler (seperti Vite atau Webpack) | partial | Vite configuration/package exists and GitHub CI monorepo build passed on `91b0a23`; deployed/browser behavior remains unverified. |
| SQ-03 | Full-Stack | Back-end dibangun dengan Express dan URL API sesuai konvensi (misal: /api/v1/resource) | partial | Express `/api/v1` authentication/origin/CSRF negative cases passed in hosted CI; broader feature-route coverage and browser E2E remain pending. |
| SQ-04 | Full-Stack | Antarmuka menggunakan CSS framework dan UI component modern | partial | Responsive CSS/UI source exists; visual browser review not run. |
| SQ-05 | Full-Stack | Networking calls menggunakan Axios | not-started | Client uses native fetch rather than the checklist's Axios target. |
| SQ-06 | Full-Stack | Data tersimpan secara persisten. | blocked | `UserSession` migrations and disposable PostgreSQL integration passed in hosted CI, but persistence across production restarts/redeploy remains unverified. |
| SQ-07 | Full-Stack | Layanan Gen AI diakses melalui Backend, bukan langsung dari Frontend. | partial | Server-side AI route code exists; provider integration not configured/executed. |
| SQ-08 | Full-Stack | Hasil tim Data Science (dasbor, prediksi, atau rekomendasi) tampil pada fitur yang relevan. | partial | Demand-prediction integration source exists; no running ML/API proof. |
| SQ-09 | Full-Stack | Riwayat hasil layanan Gen AI tersimpan di database. | partial | AiInteraction persistence model/path exists; migration/runtime unverified. |
| SQ-10 | Full-Stack | Backend memvalidasi data menggunakan schema validation (seperti Joi). | partial | Zod request validation remains present; selected session/CSRF/origin negative tests passed in hosted CI, but full route input validation coverage remains pending. |
| SQ-11 | Full-Stack | Menangani kegagalan aplikasi maupun layanan Gen AI dan Data Science dengan pesan yang jelas. | partial | Error envelopes cover unauthenticated/CSRF/origin cases; failed server/network logout now retains state and shows retry guidance. Web unit and API integration tests passed in hosted CI; browser E2E error UX remains unverified. |
| SQ-12 | Full-Stack | Mockup dibuat sebelum pengembangan. | not-started | No pre-development mockup evidence is asserted. |
| SQ-13 | Full-Stack | Antarmuka responsif dengan keputusan desain yang jelas, bukan sekadar mengikuti template umum. | partial | Responsive breakpoints/source patterns observed; no device test. |
| SQ-14 | Full-Stack | Riwayat kode dikelola dengan Git dan GitHub (atau layanan sejenis). | partial | Git history, remote branch, and PR #1 are evidenced by owner GitHub CLI output; team collaboration/review process remains unverified. |
| SQ-15 | Full-Stack | Kontrak API atau format data disepakati dengan tim Gen AI dan Data Science sebelum pengembangan. | partial | Written API contract exists; no independent agreement record. |
| SQ-16 | Full-Stack | Aplikasi di-deploy ke layanan gratis atau free tier (seperti Netlify, Render, Neon, atau Cloudflare Pages). | blocked | Blocked: no free-tier deployment is available to verify. |
| SQ-17 | Gen AI | Memeriksa keseimbangan jumlah data antarkelas pada dataset dari tim Data Science dan menanganinya JIKA tidak seimbang, lalu menjelaskan penanganannya di README. | partial | Synthetic intent corpus/class-balance logic exists; training not executed. |
| SQ-18 | Gen AI | Menerapkan teknik untuk meningkatkan kinerja model, seperti augmentasi data atau penyetelan hyperparameter, lalu menuliskan pengaruhnya terhadap hasil model di README. | not-started | No tuning experiment or comparison evidence was observed. |
| SQ-19 | Gen AI | Menguji model menggunakan data uji yang disisihkan dengan metrik yang sesuai dengan jenis tugasnya, seperti F1-score untuk klasifikasi atau precision@k untuk rekomendasi, lalu menuliskan hasilnya di README. | partial | Held-out metric code exists; metrics not regenerated in this sprint. |
| SQ-20 | Gen AI | Melatih model tambahan yang melengkapi solusi, misalnya model klasifikasi sentimen ulasan pelanggan dengan minimal 2 kelas, yaitu positif dan negatif. Hasilnya dapat ditampilkan di aplikasi web tim atau di dasbor tim Data Science. | partial | Demand regressor complements intent classifier in source. |
| SQ-21 | Gen AI | Membangun sistem RAG yang terdiri dari model generation (API proprietary atau SLM/LLM open-source yang di-host lokal), model embedding, dan vector database (ChromaDB, FAISS, Pinecone, Weaviate). | partial | RAG/vector-db source and fallback tests exist; GitHub CI ML pytest passed on `91b0a23`, but full embedding-backed Chroma retrieval and provider generation remain unverified. |
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

## Verification evidence — GitHub CI versus local sandbox

On 25 October 2026 the repository owner provided GitHub CLI output for commit `52103320ef5904ef56ac6cf3185270a22c57534f`: **4/4 CI checks passed**. These CI results are separate from the local Codex sandbox restrictions.

| Evidence | Observation | Conclusion |
| --- | --- | --- |
| GitHub Actions `push`, run `40156431701` | `api-and-web` PASS; `ml` PASS. | 2/2 jobs passed |
| GitHub Actions `pull_request`, run `40156434593` | `api-and-web` PASS; `ml` PASS. | 2/2 jobs passed |
| API/Web CI workflow | `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, and `pnpm test` are the configured stages. | Successful workflow, including the new Contracts/Web test baseline |
| ML CI workflow | CPU-only PyTorch verification, RAG dependency imports and `python -m pytest -q` are configured. | Successful ML CI tests; not a full embedding/provider smoke test |
| `pnpm lint` | Not included in this CI workflow. | Not verified by GitHub CI |
| Local Codex pnpm commands | Install, generate, build, test and lint blocked by pnpm store symlink `EPERM`. | Local sandbox limitation, not a CI failure |
| Local Python syntax | ML `compileall` was reported PASS by Codex. | Syntax validation only |
| Local Python pytest | Unavailable in the bundled Python runtime. | Local sandbox limitation; CI pytest passed separately |
| `docker compose config`, PostgreSQL migrations, browser E2E | Not executed with working Docker/DB/browser environments. | Unverified |
| Local Codex Git staging | `.git/index.lock` permission denied. | Owner successfully committed/pushed from Windows PowerShell |

Earlier CI failures (`pnpm` version conflict, PyTorch/CUDA disk quota, ignored build scripts, and missing Contracts Vitest files) were superseded by the passing workflows for `5210332`. New CI results after any subsequent documentation-only commit must still be checked.

## Sprint 02 security implementation and evidence boundary

- Implemented source: `UserSession` migrations, SHA-256-only opaque session persistence, stable CSRF issuance for concurrent `/me` reads, HttpOnly cookie delivery, server-side revocation/replay rejection, fresh database role/account checks, tenant comparison, and CSRF/trusted-origin middleware.
- Browser source: credentialed fetch holds only CSRF in memory, passes query cancellation signals, scopes protected React Query keys by tenant/user/role, evicts that cache on session transitions, and preserves multipart boundaries. Failed logout stays visible/retryable until server revocation is confirmed.
- Test source: API integration covers bootstrap/session hashing, replay, bearer/tamper/expiry rejection, CSRF/origin, concurrent `/me`, multipart, RBAC and tenant isolation. Web tests cover cookie/CSRF/FormData, per-principal cache eviction and confirmed/unconfirmed logout behavior.
- CI source: `api-and-web` now starts disposable PostgreSQL 16, executes `prisma migrate deploy`, then build, tests, and typecheck lint. The previous head `2645d05` failed API/Web TypeScript build; these corrections require a fresh observed CI result before any `verified` claim.

## Current blockers and reproduce outside this sandbox

Local `pnpm install --frozen-lockfile`, Prisma generation/migration, build, test and lint remain blocked by the sandbox project-store symlink `EPERM`; Docker/PostgreSQL are also unavailable. These are environment blockers, not a conclusion about source correctness. Run the PR workflow or a normal Windows PowerShell environment with Node 24, pnpm 11 and Docker Desktop; only promote a row to `verified` after recording an observed passing command and behavior.


## Sprint 03 code-review corrections — 26 October 2026

PR #3 review found HIGH-03 through HIGH-05. The correction set adds an eligible-member server query that filters active teacher/employee records before search/pagination, rejects external XLSX relationships/hyperlinks and formulas anywhere in allowed sheets, moves synthetic examples out of the importable sheet, makes membership create/status audit-atomic, and rejects manual SIMS activation changes. FR-003 delete remains a deliberate soft-deactivation policy to preserve records and history.

Local evidence: API Master Data unit 7/7, build, lint, Prisma generation and schema validation pass. Contracts 3/3, Web 13/13 and API non-database unit 9/9 pass in the full local command. PostgreSQL integration is intentionally blocked locally without Docker and a disposable database. The temporary correction is not pushed; all HIGH findings remain pending hosted CI rather than `verified`.

MED-01 is mandatory before real personal data: add scheduled expiry cleanup for structured preview payloads. All 86 requirement IDs remain tracked; no blanket completion claim is made.

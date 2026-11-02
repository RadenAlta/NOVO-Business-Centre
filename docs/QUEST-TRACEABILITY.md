# Asah Quest Traceability

**Sprint 03 update date:** 27 October 2026
**Rule:** a source file is not evidence of a completed quest. Each row below uses the project status vocabulary and is intentionally limited to this workspace audit.

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
| SQ-01 | Full-Stack | Front-end dan Back-end dibangun terpisah (decoupled) dan saling terhubung memalui networking call | partial | Vite and Express remain decoupled; protected calls use credentialed cookie fetch with abort signals and tenant/user/role cache isolation. Runtime flow is pending. |
| SQ-02 | Full-Stack | Front-end dibangun dengan module bundler (seperti Vite atau Webpack) | partial | Vite configuration/package exists and GitHub CI monorepo build passed on `91b0a23`; deployed/browser behavior remains unverified. |
| SQ-03 | Full-Stack | Back-end dibangun dengan Express dan URL API sesuai konvensi (misal: /api/v1/resource) | partial | Express `/api/v1` has server-side session, CSRF and origin middleware; integration suite is awaiting execution. |
| SQ-04 | Full-Stack | Antarmuka menggunakan CSS framework dan UI component modern | partial | Responsive CSS/UI source exists; visual browser review not run. |
| SQ-05 | Full-Stack | Networking calls menggunakan Axios | not-started | Client uses native fetch rather than the checklist's Axios target. |
| SQ-06 | Full-Stack | Data tersimpan secara persisten. | blocked | `UserSession` migrations include stable-CSRF compatibility and CI provides disposable PostgreSQL, but no fresh migration/runtime result has been observed. |
| SQ-07 | Full-Stack | Layanan Gen AI diakses melalui Backend, bukan langsung dari Frontend. | partial | Server-side AI route code exists; provider integration not configured/executed. |
| SQ-08 | Full-Stack | Hasil tim Data Science (dasbor, prediksi, atau rekomendasi) tampil pada fitur yang relevan. | partial | Demand-prediction integration source exists; no running ML/API proof. |
| SQ-09 | Full-Stack | Riwayat hasil layanan Gen AI tersimpan di database. | partial | AiInteraction persistence model/path exists; migration/runtime unverified. |
| SQ-10 | Full-Stack | Backend memvalidasi data menggunakan schema validation (seperti Joi). | partial | Zod validation plus session/CSRF/trusted-origin checks are in source; runtime evidence pending. |
| SQ-11 | Full-Stack | Menangani kegagalan aplikasi maupun layanan Gen AI dan Data Science dengan pesan yang jelas. | partial | API error envelopes and retryable failed-logout UI path are in source; runtime journey remains pending. |
| SQ-12 | Full-Stack | Mockup dibuat sebelum pengembangan. | not-started | No pre-development mockup evidence is asserted. |
| SQ-13 | Full-Stack | Antarmuka responsif dengan keputusan desain yang jelas, bukan sekadar mengikuti template umum. | partial | Responsive breakpoints/source patterns observed; no device test. |
| SQ-14 | Full-Stack | Riwayat kode dikelola dengan Git dan GitHub (atau layanan sejenis). | partial | Git history and PR #1 exist; all four owner-reported CI checks passed on `5210332`; team collaboration/review evidence remains incomplete. |
| SQ-15 | Full-Stack | Kontrak API atau format data disepakati dengan tim Gen AI dan Data Science sebelum pengembangan. | partial | Written API contract exists; no independent agreement record. |
| SQ-16 | Full-Stack | Aplikasi di-deploy ke layanan gratis atau free tier (seperti Netlify, Render, Neon, atau Cloudflare Pages). | blocked | Blocked: no free-tier deployment is available to verify. |
| SQ-17 | Gen AI | Memeriksa keseimbangan jumlah data antarkelas pada dataset dari tim Data Science dan menanganinya JIKA tidak seimbang, lalu menjelaskan penanganannya di README. | partial | Synthetic intent corpus/class-balance logic exists; training not executed. |
| SQ-18 | Gen AI | Menerapkan teknik untuk meningkatkan kinerja model, seperti augmentasi data atau penyetelan hyperparameter, lalu menuliskan pengaruhnya terhadap hasil model di README. | not-started | No tuning experiment or comparison evidence was observed. |
| SQ-19 | Gen AI | Menguji model menggunakan data uji yang disisihkan dengan metrik yang sesuai dengan jenis tugasnya, seperti F1-score untuk klasifikasi atau precision@k untuk rekomendasi, lalu menuliskan hasilnya di README. | partial | Held-out metric code exists; metrics not regenerated in this sprint. |
| SQ-20 | Gen AI | Melatih model tambahan yang melengkapi solusi, misalnya model klasifikasi sentimen ulasan pelanggan dengan minimal 2 kelas, yaitu positif dan negatif. Hasilnya dapat ditampilkan di aplikasi web tim atau di dasbor tim Data Science. | partial | Demand regressor complements intent classifier in source. |
| SQ-21 | Gen AI | Membangun sistem RAG yang terdiri dari model generation (API proprietary atau SLM/LLM open-source yang di-host lokal), model embedding, dan vector database (ChromaDB, FAISS, Pinecone, Weaviate). | partial | RAG/vector-db source and fallback tests exist; GitHub CI ML pytest passed on `91b0a23`, but embedding-backed retrieval and provider generation are unverified. |
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

## Quest subtotal

| Status | Main Quest | Side Quest | Total |
| --- | ---: | ---: | ---: |
| verified | 0 | 0 | 0 |
| partial | 19 | 35 | 54 |
| blocked | 1 | 2 | 3 |
| not-started | 0 | 5 | 5 |

No score, course-completion claim, or `62/62` claim is made. The next status change must cite a test result or a documented manual observation.

## Sprint 02 security traceability note

The 62 quest rows remain in scope and retain their conservative statuses. Sprint 02 correction adds source/test evidence most directly to SQ-01, SQ-03, SQ-06, SQ-10 and SQ-11, including stable CSRF concurrency, cache isolation and unconfirmed-logout handling. The PostgreSQL migration and security integration scenarios passed in hosted CI at `91b0a23` (API/Web push and PR jobs successful). Rows remain conservatively partial/blocked where full user-facing workflows, persistence across redeploy, or production deployment are not demonstrated.

## Sprint 03 code-review correction traceability note

All 20 Main Quest and 42 Side Quest rows remain in scope. The correction set strengthens SQ-01, SQ-03, SQ-06, SQ-10 and SQ-11 with server-side candidate paging, atomic audit behavior, stricter workbook policy, and regression coverage. The branch has not yet run hosted CI for these edits, so no quest is promoted to `verified` and the review recommendation remains REQUEST CHANGES pending PR #3 checks.


## Sprint 03 security-hardening note

HIGH-06 and HIGH-07 change only the FR-004 import-security boundary. The 20 Main Quest and 42 Side Quest entries above remain tracked with their existing statuses; no quest is promoted to `verified` by the local parser tests. MED-01 scheduled preview-retention purge remains OPEN before production personal data.

## Sprint 04 CP4-D2 traceability note

The SKU-integrity and inventory-idempotency changes support FR-006 and the existing full-stack persistence/security work. HIGH-02A/B have recorded PostgreSQL CI evidence; owner-provided isolated `novo_test` evidence records 35/35 security integration PASS and a passing SKU migration harness. Migration `202610290007_store_inventory_idempotency` extends the Store persistence boundary. This does not promote any Main Quest or Side Quest to `verified`. All 20 Main Quest and 42 Side Quest rows remain tracked. MED-01 remains OPEN before production personal-data use.

# CP6-AI-DS-02 — Bukti Integrasi F4 Aman

Checkpoint ini menghubungkan model F4 `FINAL_EVALUATED` sebagai **saran kategori saja**. Tidak ada tabel aktivitas baru, migrasi, atau perubahan pada billing, invoice, payment, settlement, stok, maupun approval.

## Kontrak dan batas keamanan

- Browser hanya memanggil `POST /api/v1/analytics/activity-classification` melalui cookie HttpOnly. FastAPI `POST /v1/activity-category/predict` tetap layanan internal.
- Express mewajibkan session, CSRF, Origin tepercaya, dan `requireRoles("OWNER", "ADMIN", "ANALYST")`; tenant tidak diterima dari body klien.
- Request bersifat strict `{ noteDeidentified }`, dinormalisasi dengan batas 3–500 karakter. Input dengan `tenantId` atau field asing ditolak.
- Proxy memberlakukan timeout lima detik dan memvalidasi enum label serta tepat satu dari `confidence`/`decisionScore` sebelum respons dikirimkan.
- Audit hanya menyimpan label, versi model/label, dan status; catatan mentah tidak ditulis ke audit atau respons.
- FastAPI hanya memuat `NOVO_ACTIVITY_MODEL_DIR` (default artefak final v0.2). Artefak hilang atau bukan final approved menyebabkan ketersediaan F4 gagal-tertutup; tidak ada retraining atau fallback artefak lama.
- UI menyediakan kategori manual sebagai draft browser-only. Tidak ada tombol atau klaim bahwa draft tersimpan.

## Status release gate per 6 November 2026

| Gate | Status | Bukti / batasan |
| --- | --- | --- |
| `INTEGRATION_CODE_COMPLETE` | PARTIAL | Jalur FastAPI → Express → React dan kontrak sudah ditulis serta type-checked; acceptance runtime belum selesai. |
| `BACKEND_TESTED` | NOT VERIFIED | Regression security Express ditulis di `security.integration.test.ts`, tetapi PostgreSQL disposable tidak tersedia pada sesi ini. |
| `FASTAPI_RUNTIME_VERIFIED` | PARTIAL | Artefak final berhasil dimuat dan diinferensikan lokal; endpoint HTTP FastAPI tidak dijalankan sebagai layanan pada checkpoint ini. |
| `BROWSER_E2E_VERIFIED` | NOT VERIFIED | Web build/unit test lulus, namun belum ada browser E2E F4 terhadap API/model nyata. |
| `READY_FOR_CONTROLLED_DEMO` | NO | Bergantung pada test PostgreSQL, smoke HTTP FastAPI, dan browser E2E; korpus model tetap sintetis. |

## Bukti yang diamati

- API TypeScript build dan lint: PASS.
- Web production build: PASS.
- Web unit tests: 6 file / 22 test PASS, termasuk 3 test view-model F4.
- Python `compileall`: PASS.
- Focused CP6 ML tests: 19 PASS; satu peringatan cache pytest Windows tanpa dampak hasil.
- Smoke artefak final: PASS menggunakan `activity-category-v0.2-39098d6f4f26` dan note sintetis; tidak membuka ulang final hold-out.
- `git diff --check`: PASS; hanya peringatan normalisasi CRLF pada file WIP yang sudah ada.

## Wajib sebelum demo terkontrol

1. Jalankan `pnpm --filter @novo/api test` dengan `NODE_ENV=test` dan `DATABASE_URL` yang sudah diverifikasi bernama `novo_test` atau `novo_ci`; jangan gunakan `novo` atau cloud.
2. Jalankan FastAPI memakai `NOVO_ACTIVITY_MODEL_DIR=./models/activity_category_v02_final`, lalu uji endpoint HTTP internal untuk artefak tersedia dan tidak tersedia.
3. Jalankan browser E2E authenticated: saran berhasil, fallback manual ketika provider gagal, penolakan CSRF/RBAC, serta logout/replay.
4. Lakukan review manusia atas batasan model sintetis sebelum membuka akses demo.

F4, GE-07, SQ-07, SQ-08, SQ-11, SQ-15, SQ-19, SQ-25, SQ-26, dan SQ-42 tetap `PARTIAL`; tidak ada requirement yang dipromosikan menjadi `VERIFIED` oleh checkpoint ini. MED-01 tetap OPEN.

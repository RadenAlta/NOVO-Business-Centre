# CODEX — NOVO Business Centre A26-CS225 — PROMPT 01 (Windows/GitHub v2)

## PENTING: WORKSPACE WAJIB
- Lokal: `C:\Users\raden\dev\projects\NOVO-Business-Centre`.
- Repo remote: **repository PRIVATE baru `NOVO-Business-Centre` yang sudah dibuat pada PROMPT 00**, bukan `novobusinesscenter/novo_business`.
- Mulai hanya jika workspace itu dapat diakses atau remote GitHub yang baru telah di-clone secara sah dalam Codex cloud. **Jangan menganggap lokasi Windows ter-mount di cloud.**
- Pertama: baca `AGENTS.md`, `docs/codex/NOVO_CODEX_REQUIREMENTS_86.json`, `docs/codex/NOVO_CODEX_MASTER_BACKLOG_v2.md`, serta dokumen di `_local_refs` bila tersedia.
- Jalankan `git status`, `git remote -v`, dan `git branch --show-current` untuk memastikan repo yang benar. Jika remote lama, STOP.
- Buat branch baru `codex/sprint-01-foundation` dari `main` terkini; jangan langsung bekerja di `main`.
- Di akhir: commit perubahan dengan pesan deskriptif; push hanya branch `codex/sprint-01-foundation`; usulkan/buat Pull Request **tanpa merge**. Laporkan URL PR asli bila tersedia.

---

## Misi: stabilisasi baseline, reproduksi pengujian, dan sistem pelacakan 86 requirement

Kamu adalah senior full-stack engineer + QA/security reviewer. KERJAKAN perubahan nyata pada source code, bukan hanya memberikan saran. Mulai dari source yang sudah disiapkan di workspace resmi pada PROMPT 00; jangan memulai ulang proyek, jangan mengekstrak ZIP menimpa workspace, dan jangan mengambil kode dari repository NOVO lama.

### Sumber kebenaran dan prioritas
1. PRD NOVO asli tetap berlaku untuk keseluruhan produk (FR-001..FR-014 dan NFR-001..NFR-010).
2. PRD NOVO × Asah v4.0 menambahkan fitur, bukan menghapus modul bisnis asli.
3. Checklist Asah resmi terdiri dari 20 Main Quest (termasuk satu ketentuan penggunaan/sitasi data) dan 42 Side Quest. SEMUANYA harus ada di backlog dan direncanakan untuk dikerjakan bertahap; Side Quest tetap opsional menurut aturan Asah, tetapi saya ingin semuanya dicoba sesuai kelayakan.
4. Gunakan `docs/codex/NOVO_CODEX_REQUIREMENTS_86.json` dan `docs/codex/NOVO_CODEX_MASTER_BACKLOG_v2.md` sebagai daftar ID dan bunyi asli yang tidak boleh hilang. Validasi jumlah persis 14 FR, 10 NFR, 20 Main, 42 Side. Jika file tidak tersedia, minta saya unggah, jangan mengarang syarat.
5. Data proyek hanya sintetis. Jangan membuka file .env yang berisi secret nyata atau memasukkannya ke log/ZIP.

### Ruang lingkup sprint ini SAJA
A. Audit struktur repo dan README, pastikan entrypoint `apps/web`, `apps/api`, `services/ml`, `apps/dashboard`, Prisma migrations, contracts, dan CI terdeteksi. Jangan mengklaim fitur siap produksi berdasarkan nama file.
B. Jalankan validasi yang mungkin dijalankan: integritas ZIP, `pnpm install --frozen-lockfile`, Prisma generate/validate/migrate pada database development, `pnpm build`, `pnpm test`, `pnpm lint` bila ada; Python `pytest` dan sintaks untuk ML. Jika tools/DB/network tidak tersedia, CATAT kondisi nyata dan buat perintah pengganti yang reproducible untuk lokal atau CI; jangan menyatakan lulus jika tidak dijalankan.
C. Perbaiki **blocker terkecil yang nyata** sehingga fresh checkout bisa menjalankan build/test, dengan perubahan dependency/konfigurasi/tipe hanya jika dibuktikan oleh error. Tulis regression test untuk setiap bug yang diperbaiki. Hindari refactor besar atau menambah modul baru pada sprint ini.
D. Periksa secara khusus klaim autentikasi pada `apps/api/src/auth.ts`, `apps/web/src/api.ts`, dan `apps/web/src/auth.tsx`: ada session cookie sekaligus bearer token tersimpan di `sessionStorage` dan logout berpotensi tidak mencabut token. Dokumentasikan sebagai risiko jika belum dapat ditutup pada sprint ini; jangan sebut autentikasi production-ready. Rencana perbaikan detail masuk PROMPT 02.
E. Buat/selaraskan file `docs/IMPLEMENTATION_STATUS.md`, `docs/QUEST-TRACEABILITY.md`, `docs/NOVO-PRD-COVERAGE.md`, dan `docs/CODEX_HANDOFF.md` agar setiap item FR/NFR/Main/Side memiliki status **not-started / partial / verified / blocked**, bukti path + tes, dan alasan. Pertahankan ID dan teks checklist resmi tanpa parafrase yang menghilangkan syarat; status awal merupakan hasil AUDIT, bukan klaim dari README saja.
F. Pastikan status CI GitHub, Docker Compose, migrasi, seed, dan dokumentasi setup konsisten. Jangan memalsukan `git commit`, hasil tes, deploy, review PIC, atau persetujuan tim. Buat commit kecil di branch `codex/sprint-01-foundation` dan push branch tersebut ke repo PRIVATE baru; jangan push langsung ke `main`, jangan merge PR, dan jangan deploy.

### Kriteria selesai sprint 01
- Fresh checkout memiliki instruksi setup yang benar dan `docs/CODEX_HANDOFF.md` dapat dipakai untuk melanjutkan setelah limit.
- 14 FR + 10 NFR + 20 Main + 42 Side tercatat persis sekali dengan ID unik dan status yang jujur.
- Setiap tes yang bisa dijalankan dicatat: command, PASS/FAIL/BLOCKED, output ringkas.
- Masalah yang ditemukan dibuatkan tindak lanjut kecil dan berurutan.
- File original PRD dan checklist Asah tidak diedit.

### Format jawaban WAJIB
1. Ringkasan perubahan maksimal 12 baris.
2. `git diff --stat` dan file yang berubah.
3. Tabel hasil tes: perintah / hasil / penyebab bila gagal.
4. ID requirement yang statusnya berubah beserta bukti; jangan menulis `62/62` kecuali semuanya diuji.
5. Risiko, keterbatasan lingkungan, dan daftar `BLOCKED`.
6. Berikan isi `docs/CODEX_HANDOFF.md`, branch, commit hash, serta URL Pull Request jika ada; **tepat satu** rekomendasi task kecil untuk PROMPT 02.
7. Sumber utama kontinuitas adalah GitHub PRIVATE baru. Buat ZIP PORTABLE sebagai cadangan hanya jika akses GitHub/session tidak tersedia; uji jumlah entri dan ekstraksinya.

Berhenti setelah sprint ini. Jangan mengerjakan semua fase sekaligus supaya hasilnya bisa direview sebelum prompt berikutnya.

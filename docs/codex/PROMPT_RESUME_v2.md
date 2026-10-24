# CODEX — RESUME dari limit / sesi baru (Windows + GitHub)

Ini LANJUTAN proyek NOVO Business Centre A26-CS225, bukan proyek baru.

**Local Windows workspace:** `C:\Users\raden\dev\projects\NOVO-Business-Centre`.
**GitHub source of truth:** repository PRIVATE **BARU** `NOVO-Business-Centre`, bukan `novobusinesscenter/novo_business`. Baca `git remote -v` dan `git status -sb`; jika kamu tidak dapat mengakses path Windows dari cloud, clone remote baru setelah akses disediakan, jangan berpura-pura mengubah drive C:.

1. BACA `AGENTS.md`, `docs/CODEX_HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/QUEST-TRACEABILITY.md`, `docs/NOVO-PRD-COVERAGE.md`, `docs/codex/NOVO_CODEX_REQUIREMENTS_86.json`, `docs/codex/NOVO_CODEX_MASTER_BACKLOG_v2.md`.
2. Ambil branch terakhir yang tercatat di handoff. Jika ada perubahan belum di-commit, tunjukkan `git status` dulu; jangan `git reset --hard`, jangan hilangkan pekerjaan orang lain. Jangan buat proyek ulang.
3. Pastikan 14 FR, 10 NFR, 20 Main Quest, dan 42 Side Quest terdaftar tanpa duplikasi. `verified` hanya jika ada bukti implementasi dan test nyata.
4. Pilih hanya satu item `NEXT` dari handoff. Implementasikan, uji, tambahkan regression test, perbarui docs, commit & push branch fitur (bukan `main`). Jika perlu Pull Request, buat tanpa merge.
5. Jika GH auth/remote tidak bisa digunakan, simpan checkpoint lokal dan ZIP valid; jangan menyatakan push berhasil. Jangan masukkan `_local_refs/`, `.env`, secrets, data produksi, node_modules, atau cache.

Output wajib: workspace benar, branch, commit, remote URL, perubahan file, requirement IDs, tes PASS/FAIL/BLOCKED, blocker, URL PR bila ada, dan langkah berikutnya. Stop setelah 1 task selesai atau saat mencapai limit.

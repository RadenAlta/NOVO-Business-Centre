# CODEX — PROMPT 00: Setup LOCAL Windows workspace & NEW PRIVATE GitHub repository

Anda bertindak sebagai senior developer yang menginisialisasi workspace pengembangan, bukan membuat ulang proyek. **Eksekusi instruksi ini pada Windows**, jika Codex memiliki akses file lokal (Codex CLI atau ekstensi IDE).

**Path tunggal yang wajib digunakan:** `C:\Users\raden\dev\projects\NOVO-Business-Centre`.
**Nama repository GitHub BARU:** `NOVO-Business-Centre`.
**Visibility:** PRIVATE.
**Namespace/owner:** akun GitHub yang sudah saya login menggunakan `gh auth login`. Jangan mengasumsikan nama pengguna GitHub, dan jangan menggunakan remote lama `novobusinesscenter/novo_business`.

## Tujuan
1. Verifikasi lingkungan Windows dan lokasi kerja. Jika Codex tidak dapat mengakses `C:\Users\raden`, berhenti: jangan membuat folder dengan path literal Windows di Linux/cloud. Minta saya menjalankan setup lokal dan menghubungkan GitHub ke Codex cloud.
2. Ekstrak starter pack di folder sementara dan jalankan `scripts/setup_novo_windows.ps1` dari folder paket itu. Script memulihkan source dari `resources/NOVO-Business-Centre-portable-2026-10-25.zip` hanya bila target kosong; jika proyek sudah ada, **jangan overwrite**. Jika script belum tersedia di workspace, arahkan saya untuk ekstrak ZIP paket yang dilampirkan.
3. Jika `git`, `gh`, `node`, `pnpm`, Python atau Docker tidak ada, catat hasil `--version` yang bisa dijalankan dan berikan langkah instalasi khusus Windows yang sesuai. Jangan mengaku sudah menginstal tool jika gagal/tidak dijalankan.
4. Periksa konfigurasi `git config user.name` dan `git config user.email`. Jangan mengarang identitas commit.
5. Login GitHub **hanya melalui metode interaktif resmi** (`gh auth login -h github.com -p https -w`). Jangan meminta PAT/password di chat, jangan tampilkan token.
6. Buat satu Git repository lokal dengan branch `main`, satu initial commit setelah pemeriksaan `.gitignore` dan secrets, lalu buat repository **baru dan private** via `gh repo create NOVO-Business-Centre --private --source . --remote origin --push`. Jika repo bernama sama sudah ada, jangan gunakan/overwrite secara diam-diam; laporkan konflik.
7. Pastikan `origin` menunjuk repository baru, `main` sudah di-push, dan `git status --short` bersih. Cetak URL aktual dari `gh repo view --json url --jq .url`, bukan URL tebakan.
8. Pastikan file `_local_refs/` terabaikan dan tidak di-push, sementara `AGENTS.md`, `docs/codex/NOVO_CODEX_REQUIREMENTS_86.json`, dan master backlog tersedia di repo.
9. Jangan mulai pekerjaan fitur, modifikasi database produksi, atau deployment.

## Perintah verifikasi lokal (PowerShell)
```powershell
cd 'C:\Users\raden\dev\projects\NOVO-Business-Centre'
Get-Location
git status --short --branch
git remote -v
gh repo view --json nameWithOwner,isPrivate,url
git ls-files _local_refs
node --version
pnpm --version
git --version
gh --version
```

## Hasil yang harus dilaporkan
- Workspace directory yang **benar-benar diakses**, kondisi awal (kosong/sudah berisi source), dan jumlah file sumber.
- Git commit hash, origin yang benar, URL GitHub nyata, dan status PRIVATE.
- Hasil verifikasi dan blockers yang ada, tanpa klaim palsu.
- Jika file workspace tidak tersedia, jangan lanjut; jelaskan dengan tepat tindakan pengguna yang diperlukan.

**Berhenti di akhir PROMPT 00. Jangan lanjut sprint 01 sebelum saya review.**

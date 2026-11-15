# Kontrak Dataset Catatan Aktivitas F4 v0 2

Status: draft teknis CP6-AI-DS-01D, menunggu persetujuan PIC. Kontrak ini membatasi demonstrator F4 untuk memberi saran kategori atas catatan operasional yang telah dideidentifikasi. Ia bukan kontrak transaksi, tidak memberi kewenangan otomatis kepada model, dan tidak menggantikan keputusan pengguna atau kebijakan PIC.

## Tujuan dan kompatibilitas

F4 mengusulkan satu kategori tindak lanjut: `INVENTORY`, `SALES`, `SERVICE`, atau `ADMINISTRATION`. Taksonomi label tetap `activity-category-v0.1`; yang berubah adalah dataset `activity-dataset-v0.2`: jumlah skenario mandiri, rubric pelabelan, metadata review, dan split berkelompok. Dengan demikian pipeline lama tetap menerima record berlabel v0.1, tetapi artefak model v0.1 tidak boleh diklaim telah dievaluasi pada dataset v0.2.

Dataset ini berbeda dari intent layanan/RAG: intent menjawab arah pertanyaan pengguna; kategori F4 menjawab tindakan utama sebuah catatan aktivitas. Prediksi F4 hanya saran yang dapat dikoreksi manusia dan tidak boleh menulis stok, invoice, pembayaran, settlement, membership, approval, atau hak akses.

## Schema

| Field | Type | Aturan |
| --- | --- | --- |
| `activity_id` | string | Pseudonim unik, hanya `[A-Za-z0-9._:-]`. |
| `occurred_at` | ISO-8601 datetime | Timezone eksplisit. |
| `business_unit` | enum | `STORE`, `SHUTTLE`, `CATERING`, `FUNDING`, `FINANCING`, atau `OPERATIONS`. |
| `note_deidentified` | string | 12–500 karakter, tanpa nama, kontak, alamat, nomor pembayaran, atau identitas langsung. |
| `category_label` | enum | Salah satu label `activity-category-v0.1`; seluruh label masih provisional. |
| `source_type` | enum | `SYNTHETIC` atau `CONSENTED_DEIDENTIFIED`; CP6 v0.2 hanya menghasilkan `SYNTHETIC`. |
| `label_version` | string | Tepat `activity-category-v0.1`. |
| `provenance` | string | Generator, versi dataset, seed, dan batas penggunaan. |
| `split` | enum | `TRAIN`, `VALIDATION`, atau `TEST`. |
| `template_family` | string | Keluarga skenario; wajib pada generator dan tidak boleh melintasi split. |
| `semantic_group` | string | Kelompok semantik yang diaudit; tidak boleh melintasi split. |
| `primary_action` | string | Dasar pelabelan yang dapat direview manusia. |
| `review_status` | enum | `CLEAR` atau `AMBIGUOUS_REVIEWED`. |

Sembilan field pertama wajib bagi pipeline. Lima metadata terakhir dipertahankan saat validasi dan diperlukan untuk audit v0.2. Record tanpa metadata v0.2 tetap dapat dibaca untuk kompatibilitas, tetapi tidak boleh dicampurkan ke eksperimen v0.2 tanpa review/migrasi metadata.

## Privasi dan provenance

- Semua 144 record v0.2 adalah kalimat sintetis. Tidak ada data siswa, wali, guru, pegawai, pelanggan, rekening, telepon, atau pembayaran nyata.
- Data primer hanya boleh masuk setelah izin, de-identifikasi, owner data, tujuan, retensi, akses per field, dan prosedur penarikan persetujuan terdokumentasi.
- Generator dan validator menolak catatan kosong, label tidak dikenal, waktu tidak valid, dan pola kontak yang jelas. Pemeriksaan ini bukan jaminan anonimisasi penuh; human review tetap wajib.
- Label tidak boleh diambil dari prediksi model. Ketidaksepakatan label harus direkam pada review.

## Split dan evaluasi

Seed default adalah `20261105`. Setiap label memiliki 12 keluarga mandiri: enam train, tiga validation, dan tiga final hold-out test. Tiga formulasi satu keluarga adalah parafrasa yang sengaja berada pada split sama. Test family ditetapkan dalam manifest sebelum eksperimen dan tidak boleh digunakan untuk pemilihan fitur, model, threshold, atau perbaikan dataset.

Untuk baseline default, distribusi record seimbang: train 18/label, validation 9/label, test 9/label; total 144. Guard menolak ID/teks identik, family atau semantic group lintas split, dan near-duplicate lintas split dengan overlap token tinggi. Laporan kualitas menandai token boilerplate dan token spesifik label untuk review manusia; laporan itu bukan detektor semantik atau bukti bebas leakage.

## Kontrak FastAPI yang tetap berlaku

`POST /v1/activity-category/predict` tetap hanya menghasilkan saran kategori. Respons yang kelak memakai model v0.2 wajib menyertakan `model_version`, `label_version`, dan status inferensi. Browser tidak boleh memanggil FastAPI langsung; checkpoint integrasi terpisah harus memastikan Express melakukan otorisasi, agregasi yang diizinkan, audit, dan error handling.

## Batas bukti checkpoint

CP6-AI-DS-01E menghasilkan evaluasi development terpisah dan artefak lokal v0.2 tanpa menimpa artefak v0.1. CP6-AI-DS-01H kemudian melakukan satu evaluasi final setelah konsensus internal dilaporkan ketua tim; hasilnya tercatat di `ACTIVITY_FINAL_HOLDOUT_EVALUATION_V0_2.md` dan tidak dipakai untuk tuning ulang. F4/quest mana pun tetap belum menjadi verified karena serving, koreksi manusia, dan acceptance aplikasi belum terbukti.

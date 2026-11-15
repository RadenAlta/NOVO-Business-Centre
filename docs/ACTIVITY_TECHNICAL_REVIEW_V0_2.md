# Review Teknis Anotasi Aktivitas F4 v0 2

Checkpoint: CP6-AI-DS-01G. Status: rekomendasi teknis, bukan keputusan atau persetujuan manusia. Dataset `activity-dataset-v0.2` dengan hash `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47` dan split beku ditinjau tanpa inferensi/prediksi final hold-out.

## Prinsip penilaian

Label ditentukan oleh tindakan bisnis dominan: kuantitas/kondisi/lokasi barang adalah `INVENTORY`; nilai transaksi, pembayaran, harga, atau retur adalah `SALES`; pemenuhan/komunikasi layanan adalah `SERVICE`; dan dokumen, approval, arsip, audit, atau status formal adalah `ADMINISTRATION`. Penyebutan kata seperti “invoice”, “pembayaran”, atau “layanan” saja tidak cukup untuk menentukan label.

## Hasil per family

| Family | Label sekarang | Rekomendasi | Tindakan dominan dan justifikasi | Risiko / tindakan lanjutan |
| --- | --- | --- | --- | --- |
| `inv-supplier-shortfall` | INVENTORY | RECOMMEND_ACCEPT | Ketiga catatan meminta verifikasi barang diterima, selisih jumlah, atau status item belum datang. Ini memenuhi inclusion INVENTORY; komunikasi pemasok/dokumen hanya konteks sekunder. | Risiko salah baca sebagai administrasi. Reviewer manusia perlu memastikan tidak ada perubahan fokus ke invoice/berkas. |
| `inv-internal-transfer` | INVENTORY | RECOMMEND_ACCEPT | Ketiga catatan berpusat pada perpindahan fisik, saldo stok, dan kuantitas antar lokasi Store–Catering. | Risiko berubah menjadi ADMINISTRATION bila skenario hanya mengurus formulir. Pertahankan kata tindakan fisik/kuantitas. |
| `sales-shuttle-fee` | SALES | RECOMMEND_ACCEPT | Fokusnya pencatatan, rekonsiliasi, dan pembaruan status penerimaan biaya layanan Shuttle; sesuai inclusion SALES untuk penerimaan biaya layanan. | Pembayaran Shuttle dapat menyerupai dokumen billing. Rubric harus membedakan rekonsiliasi nominal dari pengarsipan invoice. |
| `sales-invoice-match` | SALES | RECOMMEND_ACCEPT | Nilai pesanan, total tagihan, jumlah paket, dan nominal penjualan menjadi aksi utama sebelum faktur selesai; ini tetap transaksi/nilai penjualan. | Ini batas terdekat SALES–ADMINISTRATION. Jika konteks kelak hanya kelengkapan formal invoice, buat family ADMINISTRATION baru, bukan ubah contoh ini setelah freeze. |
| `service-special-handling` | SERVICE | RECOMMEND_ACCEPT | Ketiga catatan menekankan penyesuaian penyajian, koordinasi pengantaran, dan pemenuhan kebutuhan layanan tepat waktu. | Bisa menjadi SALES bila mengandung perubahan harga atau kuantitas yang menentukan nilai jual. Tidak ada fokus itu pada teks saat ini. |
| `admin-price-approval` | ADMINISTRATION | RECOMMEND_ACCEPT | Usulan harga, otorisasi, arsip, dan status persetujuan adalah proses formal; tidak ada checkout atau koreksi transaksi. | Risiko kata “harga” menjadi shortcut SALES. Review kualitas harus terus menandai token label-specific. |
| `admin-settlement-document` | ADMINISTRATION | RECOMMEND_ACCEPT | Ketiga catatan membahas pemeriksaan dokumen/lampiran/arsip settlement, bukan perhitungan atau eksekusi pembagian hasil. | Risiko salah baca sebagai transaksi keuangan. Jangan gunakan contoh ini untuk menyimpulkan kontrol settlement otomatis. |

Seluruh tiga catatan dalam setiap family mendukung rekomendasi yang sama. Tidak ada family ambigu dalam frozen final hold-out; review ini tidak mengubah isi, label, family, hash, atau manifest.

## Ringkasan dan perbaikan rubric

Rekomendasi: 7 `RECOMMEND_ACCEPT`, 0 `RECOMMEND_CHANGE`, 0 `RECOMMEND_DISCUSSION`. Rekomendasi ini didasarkan pada definisi inclusion/exclusion, Store POS, layanan Shuttle, Catering, dan administrasi koperasi pada scope NOVO—bukan pada prediksi Logistic Regression.

Rubric perlu menambahkan tiga pertanyaan operasional sebelum pelabelan: (1) apakah output utama mengubah/merekonsiliasi nilai transaksi? Jika ya, `SALES`; (2) apakah output utama menyimpan, memeriksa, atau menyetujui dokumen/status formal? Jika ya, `ADMINISTRATION`; (3) apakah output utama adalah ketersediaan fisik barang atau pemenuhan pengalaman layanan? Pilih `INVENTORY` atau `SERVICE` sesuai objek tindakan. Perbaikan ini adalah klarifikasi untuk review mendatang; tidak mengubah taxonomy atau dataset saat ini.

## Readiness final hold-out

Secara teknis, dataset tetap layak untuk evaluasi final: manifest/hash utuh, kandidat Logistic Regression/hyperparameter sudah dibekukan, dan hold-out belum digunakan untuk seleksi. Namun status human sign-off tetap `WAITING_INTERNAL_SIGNOFF`; rekomendasi AI ini tidak menggantikan tiga keputusan manusia nyata. Karena tidak ada rekomendasi perubahan, setelah reviewer tim menyetujui seluruh family tanpa modifikasi, evaluasi final dapat dijalankan sekali menggunakan artifact development v0.2 dan output final terpisah. Bila reviewer mengubah satu label sekalipun, freeze ini harus dihentikan dan dataset/manifest diberi versi baru sebelum evaluasi apa pun.

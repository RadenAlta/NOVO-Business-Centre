# Paket Review Internal Anotasi Aktivitas F4 v0 2

Status: `WAITING_INTERNAL_REVIEW`. Paket ini disiapkan untuk Raden, Fi, dan Asep. Nama tersebut adalah calon reviewer, bukan bukti review atau persetujuan. Tidak ada prediksi model, skor final hold-out, atau rekomendasi tuning dalam paket ini.

Dataset: `activity-dataset-v0.2`; hash `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47`; seed `20261105`; label version `activity-category-v0.1`. Seluruh catatan sintetis. Referensi: [panduan anotasi](ACTIVITY_ANNOTATION_GUIDELINES_V0_2.md) bagian “Aturan umum” dan “Prioritas untuk kasus multi-topik”.

## Cara mengisi

Setiap calon reviewer memberi keputusan independen `ACCEPT`, `CHANGE`, atau `ESCALATE`, nama dirinya sendiri, tanggal aktual, dan alasan. Jika ada perubahan label atau isi family frozen final hold-out, **jangan** menyunting generator ini; hentikan gate, version-kan dataset/manifest baru, dan buka evaluasi baru. Ketujuh family berikut berada pada development split, tetapi hasil review tetap tidak boleh memakai output model.

## Inventory

| Family / activity ID | Teks sintetis | Label dan alasan teknis | Alternatif masuk akal | Keputusan | Reviewer / tanggal / catatan |
| --- | --- | --- | --- | --- | --- |
| `inv-supplier-shortfall` / `act-syn-v02-20261105-07-00` | Kiriman pemasok kurang dua dus; prioritas catatan adalah menindaklanjuti penerimaan stok, bukan pembayaran. | `INVENTORY`: tindakan utama adalah selisih penerimaan stok. | `ADMINISTRATION` bila fokus berubah menjadi dokumen penerimaan. | PENDING | — |
| `inv-supplier-shortfall` / `...-07-01` | Toko menerima barang tidak lengkap dan petugas perlu mencatat selisih persediaan sebelum menghubungi pemasok. | `INVENTORY`: catat/selesaikan selisih persediaan. | `SERVICE` bila teks hanya membahas komunikasi pemasok. | PENDING | — |
| `inv-supplier-shortfall` / `...-07-02` | Daftar penerimaan menunjukkan item belum datang; label dipilih INVENTORY karena tindakan utama adalah verifikasi stok. | `INVENTORY`: verifikasi stok. | `ADMINISTRATION` bila verifikasi menjadi kelengkapan berkas. | PENDING | — |
| `inv-internal-transfer` / `act-syn-v02-20261105-08-00` | Barang dipindahkan dari gudang ke unit katering; catatan utama adalah perpindahan persediaan antar lokasi. | `INVENTORY`: kuantitas/lokasi persediaan berubah. | `ADMINISTRATION` bila hanya meminta formulir transfer. | PENDING | — |
| `inv-internal-transfer` / `...-08-01` | Unit toko menyerahkan gelas kemasan ke dapur dan saldo stok kedua unit perlu diperbarui. | `INVENTORY`: pembaruan saldo stok. | `SERVICE` bila fokus pemenuhan pesanan, bukan stok. | PENDING | — |
| `inv-internal-transfer` / `...-08-02` | Pemindahan bahan antar gudang membutuhkan pencatatan kuantitas sebelum aktivitas layanan dilanjutkan. | `INVENTORY`: pencatatan kuantitas fisik dominan. | `SERVICE` bila tindakan dominan menjadi kelanjutan layanan. | PENDING | — |

## Sales

| Family / activity ID | Teks sintetis | Label dan alasan teknis | Alternatif masuk akal | Keputusan | Reviewer / tanggal / catatan |
| --- | --- | --- | --- | --- | --- |
| `sales-shuttle-fee` / `act-syn-v02-20261105-16-00` | Pembayaran layanan shuttle tercatat sebagian; label SALES dipilih karena tindakan utama adalah pencatatan penerimaan layanan. | `SALES`: penerimaan biaya layanan. | `ADMINISTRATION` bila hanya menangani berkas tagihan. | PENDING | — |
| `sales-shuttle-fee` / `...-16-01` | Petugas merekonsiliasi biaya perjalanan yang dibayar melalui kanal transfer. | `SALES`: rekonsiliasi penerimaan layanan. | `ADMINISTRATION` bila tanpa nilai/penerimaan transaksi. | PENDING | — |
| `sales-shuttle-fee` / `...-16-02` | Tagihan layanan antar jemput memerlukan pencatatan pembayaran sebelum status penjualan diperbarui. | `SALES`: pembayaran dan status penerimaan. | `ADMINISTRATION` bila prioritasnya dokumen invoice. | PENDING | — |
| `sales-invoice-match` / `act-syn-v02-20261105-19-00` | Nilai pesanan katering dibandingkan dengan invoice; label SALES karena fokusnya adalah nilai transaksi yang dijual. | `SALES`: nilai pesanan/transaksi utama. | `ADMINISTRATION` bila yang diperiksa hanya formalitas invoice. | PENDING | — |
| `sales-invoice-match` / `...-19-01` | Rekap paket makan perlu dicocokkan dengan total tagihan pelanggan sintetis. | `SALES`: total nilai pesanan. | `SERVICE` bila fokus berpindah ke pengantaran paket. | PENDING | — |
| `sales-invoice-match` / `...-19-02` | Unit katering meninjau selisih jumlah pesanan dan nominal penjualan sebelum faktur diselesaikan. | `SALES`: nominal penjualan dominan. | `ADMINISTRATION` bila penyelesaian faktur menjadi aksi utama. | PENDING | — |

## Service

| Family / activity ID | Teks sintetis | Label dan alasan teknis | Alternatif masuk akal | Keputusan | Reviewer / tanggal / catatan |
| --- | --- | --- | --- | --- | --- |
| `service-special-handling` / `act-syn-v02-20261105-30-00` | Permintaan penanganan paket khusus dicatat sebagai SERVICE karena tindakan utama adalah pemenuhan layanan, bukan penjualan. | `SERVICE`: pemenuhan layanan dominan. | `SALES` bila biaya/pesanan menjadi fokus. | PENDING | — |
| `service-special-handling` / `...-30-01` | Dapur menyesuaikan penyajian pesanan dengan catatan layanan yang telah disetujui. | `SERVICE`: penyajian/pemenuhan dominan. | `ADMINISTRATION` bila hanya persetujuan dokumen. | PENDING | — |
| `service-special-handling` / `...-30-02` | Koordinasi pengantaran khusus dilakukan agar kebutuhan layanan terpenuhi tepat waktu. | `SERVICE`: koordinasi pemenuhan. | `SALES` bila terkait nilai pesanan. | PENDING | — |

## Administration

| Family / activity ID | Teks sintetis | Label dan alasan teknis | Alternatif masuk akal | Keputusan | Reviewer / tanggal / catatan |
| --- | --- | --- | --- | --- | --- |
| `admin-price-approval` / `act-syn-v02-20261105-42-00` | Usulan harga toko menunggu persetujuan; label ADMINISTRATION karena tindakan utamanya adalah pencatatan persetujuan, bukan penjualan. | `ADMINISTRATION`: persetujuan formal dominan. | `SALES` bila memperbarui harga pada checkout. | PENDING | — |
| `admin-price-approval` / `...-42-01` | Dokumen otorisasi perubahan harga diverifikasi sebelum disimpan dalam arsip. | `ADMINISTRATION`: verifikasi arsip/otorisasi. | `SALES` bila transaksi harga sedang dikoreksi. | PENDING | — |
| `admin-price-approval` / `...-42-02` | Petugas menelusuri status persetujuan untuk pembaruan kebijakan harga. | `ADMINISTRATION`: status approval dominan. | `SALES` bila tindakan berikutnya adalah penjualan. | PENDING | — |
| `admin-settlement-document` / `act-syn-v02-20261105-44-00` | Dokumen pembagian hasil shuttle diperiksa; label ADMINISTRATION karena fokusnya adalah kelengkapan dokumen, bukan eksekusi pembayaran. | `ADMINISTRATION`: kelengkapan dokumen. | `SALES` bila fokus menjadi penerimaan pembayaran. | PENDING | — |
| `admin-settlement-document` / `...-44-01` | Arsip persetujuan settlement ditelaah sebelum status administrasi diperbarui. | `ADMINISTRATION`: arsip dan status formal. | `SALES` bila mengalokasikan nominal settlement. | PENDING | — |
| `admin-settlement-document` / `...-44-02` | Petugas memeriksa lampiran pembagian hasil untuk memastikan catatan formal lengkap. | `ADMINISTRATION`: lampiran/catatan formal. | `SALES` bila transaksi pembagian hasil dilakukan. | PENDING | — |

## Gate final hold-out

| Gate | Status saat paket dibuat | Evidence yang dibutuhkan sebelum final test |
| --- | --- | --- |
| Tiga keputusan manusia nyata per family | BLOCKED | Keputusan/identitas/tanggal aktual dari reviewer. |
| Konsensus atau eskalasi selesai | BLOCKED | Catatan resolusi ketidaksepakatan. |
| Dataset hash dan split baseline | PASS | Hash dan manifest v0.2 yang tercantum di atas. |
| Kandidat/hyperparameter dibekukan | PASS | Artifact Logistic Regression development dan evaluation v0.2. |
| Hold-out tidak dipakai untuk seleksi | PASS | Training report `WAITING_INTERNAL_REVIEW`, tanpa metrics final. |

Kesimpulan: final hold-out tidak boleh dieksekusi sampai dua gate review manusia pertama memiliki bukti yang dapat diaudit.

# Panduan Anotasi Aktivitas F4 v0 2

Status: draft untuk persetujuan PIC. Panduan ini berlaku untuk catatan aktivitas deidentifikasi; model hanya boleh mengusulkan label dan tidak mengesahkan tindakan operasional.

## Aturan umum

Pilih kategori berdasarkan tindakan operasional utama yang perlu ditindaklanjuti, bukan berdasarkan setiap kata yang muncul. Jika satu catatan memuat lebih dari satu tindakan, pilih tindakan yang paling dekat dengan keputusan kerja berikutnya. Jika tidak ada tindakan dominan atau konteks tidak cukup, beri flag untuk human review—jangan menebak label. Semua contoh di bawah sintetis.

| Label | Definisi dan inclusion | Exclusion | Contoh positif | Contoh negatif dan ambigu |
| --- | --- | --- | --- | --- |
| `INVENTORY` | Ketersediaan, kuantitas, lokasi, kondisi, penerimaan, perpindahan, atau kebutuhan stok fisik. | Harga checkout, penerimaan pembayaran, jadwal layanan, kelengkapan arsip. | “Bahan katering kurang sebelum produksi.” | “Kiriman kurang dan invoice pemasok belum cocok”: pilih INVENTORY bila tindakan pertama adalah verifikasi penerimaan stok; bila fokus bukti/formalitas, review ADMINISTRATION. |
| `SALES` | Penjualan, checkout/POS, harga, diskon, struk, retur transaksi, nilai pesanan, dan penerimaan biaya layanan. | Stok fisik sebelum transaksi, pemenuhan/komunikasi layanan, arsip/persetujuan. | “Harga kasir berbeda dari label rak.” | “Tagihan shuttle perlu dilengkapi”: pilih SALES hanya bila tindakan utama adalah nilai/penerimaan layanan; bila dokumen billing, ADMINISTRATION. |
| `SERVICE` | Pemenuhan layanan dan pengalaman pengguna: rute shuttle, keterlambatan, pengantaran katering, komunikasi, keluhan, kualitas layanan. | Nilai jual/pembayaran, stok, proses formal administrasi. | “Rute antar jemput berubah dan pengguna perlu diberi tahu.” | “Pesanan katering berubah”: SERVICE bila fokus pengantaran/pemenuhan; SALES bila fokus nilai pesanan. |
| `ADMINISTRATION` | Kelengkapan dokumen, pencatatan formal, persetujuan, audit, laporan, retensi, dan akses. | Eksekusi stok, checkout, atau pemenuhan layanan. | “Formulir pengajuan belum lengkap.” | “Pembagian hasil shuttle”: ADMINISTRATION bila fokus lampiran/persetujuan; bukan pengalihan dana atau settlement. |

## Prioritas untuk kasus multi-topik

1. Keselamatan atau pemenuhan layanan pengguna → `SERVICE`, kecuali catatan secara jelas meminta hitung stok atau nilai penjualan.
2. Kuantitas/kondisi/lokasi barang → `INVENTORY`.
3. Harga, penerimaan pembayaran, nilai pesanan, atau koreksi transaksi → `SALES`.
4. Dokumen, approval, arsip, audit, atau retensi → `ADMINISTRATION`.
5. Bila dua kategori setara atau tidak ada bukti tindakan berikutnya, tandai `AMBIGUOUS_REVIEWED` dan minta keputusan PIC; jangan membuat kelas baru secara ad hoc.

Sebelum memberi label, jawab tiga pertanyaan: apakah tindakan utama merekonsiliasi atau mengubah nilai transaksi (`SALES`); apakah ia memeriksa/menyimpan/menyetujui dokumen atau status formal (`ADMINISTRATION`); atau apakah objek utama adalah barang fisik (`INVENTORY`) versus pemenuhan pengalaman layanan (`SERVICE`)? Pertanyaan ini adalah klarifikasi rubric CP6-AI-DS-01G, bukan perubahan taxonomy.

## Human review

Dua reviewer memeriksa catatan ambigu secara mandiri, mencatat label awal, alasan, unit usaha, dan tindakan dominan. Ketidaksepakatan diselesaikan PIC; keputusan dan alasan ditambahkan ke katalog tanpa menyunting final hold-out setelah eksperimen dimulai. Setiap perubahan taksonomi menaikkan `label_version`, membekukan dataset baru, dan memerlukan training/evaluasi ulang.

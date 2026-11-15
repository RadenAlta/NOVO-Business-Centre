# Laporan Kualitas Dataset Aktivitas F4 v0 2

Tanggal generator: 6 November 2026. Dataset: `activity-dataset-v0.2`. Seed: `20261105`. Hash: `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47`.

## Hasil pemeriksaan otomatis

| Pemeriksaan | Hasil |
| --- | --- |
| Total record dan family | 144 record; 48 family mandiri |
| Distribusi | Train 72, validation 36, test frozen 36; tiap split seimbang per label 18/9/9 |
| Exact duplicate | Tidak ada; validator menolak teks identik |
| Group leakage | Tidak ada; validator menolak `template_family` atau `semantic_group` lintas split |
| Near duplicate | Guard Jaccard token lintas split pada ambang 0,80; lulus untuk generator v0.2 |
| Privacy baseline | Sumber seluruhnya `SYNTHETIC`; pola kontak yang jelas ditolak |
| Ambigu | 21 record/7 family ditandai `AMBIGUOUS_REVIEWED` |

## Sinyal yang wajib ditinjau manusia

Token lintas label yang sering muncul—misalnya `catatan`, `perlu`, `petugas`, `layanan`, `toko`, `shuttle`, dan `transaksi`—ditandai sebagai boilerplate potensial. Token yang saat ini hanya muncul pada satu label—misalnya `stok`/`persediaan`, `kasir`/`rekap`, `operator`/`titik`, atau `administrasi`/`dokumen`—juga perlu ditinjau agar model tidak hanya menghafal kata kunci.

Pemeriksaan otomatis tidak mampu membuktikan dua kalimat adalah parafrasa semantik. Reviewer harus membandingkan family baru dengan seluruh split, khususnya kasus “tagihan layanan”, “pembagian hasil”, “pesanan berubah”, dan “kiriman pemasok kurang”. Tidak ada perubahan terhadap frozen hold-out yang boleh dibuat setelah eksperimen dimulai.

## Batas laporan

Laporan ini tidak menggantikan evaluasi model dan tidak membatalkan hasil rendah v0.1. Ia membuktikan generator dan guard v0.2 lulus unit test pada checkpoint ini. Delegasi teknis PIC tidak menggantikan review internal tujuh family ambigu; statusnya tetap `INTERNAL_REVIEW_PENDING`.

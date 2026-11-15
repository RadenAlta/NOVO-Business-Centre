# Checklist Review Manusia Aktivitas F4 v0 2

Gunakan checklist ini sebelum data berlabel masuk korpus, sebelum final hold-out dibekukan, dan sebelum model diintegrasikan.

- [ ] Catatan tidak memuat nama, kontak, alamat, nomor rekening, nomor pembayaran, atau ID operasional nyata.
- [ ] `source_type`, provenance, dan batas penggunaan dapat ditelusuri.
- [ ] Label sesuai tindakan utama pada panduan anotasi; bukan kata kunci tunggal.
- [ ] Unit usaha dan `primary_action` sesuai konteks Store, Shuttle, Catering, atau administrasi koperasi.
- [ ] Kasus multi-topik memiliki alasan prioritas yang tertulis.
- [ ] Kasus ambigu ditandai `AMBIGUOUS_REVIEWED` dan keputusan PIC direkam.
- [ ] Tidak ada kalimat identik, paraphrase semantik, atau keluarga scenario pada split berbeda.
- [ ] Tidak ada boilerplate atau token khusus label yang membuat prediksi menjadi jalan pintas tanpa makna operasional.
- [ ] Final hold-out belum dilihat oleh pihak yang memilih model/fitur/threshold.
- [ ] Perubahan taxonomy atau split memiliki versi baru, hash, dan persetujuan PIC.

Delegasi teknis PIC sudah menjadi konteks proyek, tetapi reviewer internal belum dicatat. Status sign-off: `INTERNAL_REVIEW_PENDING`. Checklist ini bukan pengganti review keamanan, privasi, atau izin data nyata.

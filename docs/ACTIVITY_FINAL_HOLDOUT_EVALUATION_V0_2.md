# Evaluasi Final Hold Out Aktivitas F4 v0 2

Checkpoint: CP6-AI-DS-01H. Evaluasi final dilakukan satu kali pada 6 November 2026 setelah konfirmasi ketua tim Raden Dimas Taufik Rahmat bahwa konsensus internal menerima ketujuh label ambigu tanpa perubahan. Konfirmasi ketua tim adalah provenance keputusan; Codex tidak menyaksikan tanda tangan atau timestamp individual Raden, Fi Amalia Utami, maupun Asep Kurniawan.

## Integritas dan protokol

- Dataset: `activity-dataset-v0.2`; hash `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47`.
- Taxonomy: `activity-category-v0.1`; seed `20261105`.
- Final hold-out: 36 record, 12 family, 9 record per label; manifest tidak berubah.
- Model telah dipilih sebelum hold-out: TF-IDF n-gram 1–2 dengan `sublinear_tf=True`, Logistic Regression `max_iter=3000`, `class_weight=balanced`, `random_state=20261105`.
- Artefak final terpisah: `services/ml/models/activity_category_v02_final/`. Artefak development v0.2 dan artefak v0.1 tidak ditimpa.
- Hasil ini tidak digunakan untuk mengganti kandidat, parameter, label, maupun split.

## Metrik aktual

| Metrik | Development validation | Final hold-out | Selisih final minus validation |
| --- | ---: | ---: | ---: |
| Macro-F1 | 0.864268 | 0.916409 | +0.052141 |
| Weighted-F1 | 0.864268 | 0.916409 | +0.052141 |
| Accuracy | 0.861111 | 0.916667 | +0.055556 |

| Label | Precision | Recall | F1 | Support |
| --- | ---: | ---: | ---: | ---: |
| INVENTORY | 0.800000 | 0.888889 | 0.842105 | 9 |
| SALES | 1.000000 | 1.000000 | 1.000000 | 9 |
| SERVICE | 0.875000 | 0.777778 | 0.823529 | 9 |
| ADMINISTRATION | 1.000000 | 1.000000 | 1.000000 | 9 |

Confusion matrix, baris aktual dan kolom prediksi dalam urutan `INVENTORY`, `SALES`, `SERVICE`, `ADMINISTRATION`:

```text
[[8, 0, 1, 0],
 [0, 9, 0, 0],
 [2, 0, 7, 0],
 [0, 0, 0, 9]]
```

## Error analysis

Tiga dari 36 record salah klasifikasi. Sisa bahan menu untuk perencanaan produksi (`INVENTORY`) diprediksi `SERVICE`; dua catatan kualitas/penyajian paket katering (`SERVICE`) diprediksi `INVENTORY`. Ini adalah batas bahasa antara bahan fisik dan pemenuhan layanan katering. Error dicatat, tetapi tidak digunakan untuk menambah data, memilih ulang model, atau mengubah final hold-out.

## Keputusan readiness

Status model: `FINAL_EVALUATED`. Model belum `READY_FOR_CONTROLLED_DEMO` dan bukan `PRODUCTION_READY`: korpus seluruhnya sintetis dan kecil, group-CV masih bervariasi, tidak ada Express/React tenant-scoped integration, belum ada UI koreksi manusia, dan belum ada evaluasi manfaat pengguna. Prediksi tetap suggestion-only dan tidak boleh memutasi data NOVO.

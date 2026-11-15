# Evaluasi Development Model Aktivitas F4 v0 2

Checkpoint: CP6-AI-DS-01E. Dataset `activity-dataset-v0.2`, hash `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47`, label `activity-category-v0.1`, seed `20261105`. Runtime aktual: Python 3.12.13 dan scikit-learn 1.9.1. Semua data bersifat sintetis.

## Protokol

Tiga kandidat dilatih pada train 72 record. TF-IDF hanya di-fit dalam pipeline pada setiap fit/fold. Validation 36 record menentukan kandidat. Group-aware `StratifiedGroupKFold` tiga fold dipakai hanya pada train berdasarkan `template_family`. Final hold-out 36 record tidak dibaca selama seleksi maupun training checkpoint ini.

| Kandidat | Validation macro F1 | Weighted F1 | Accuracy | Group CV macro F1 mean ± sd | Keputusan |
| --- | ---: | ---: | ---: | ---: | --- |
| Dummy most frequent | 0.100000 | 0.100000 | 0.250000 | 0.100000 ± 0.000000 | Baseline pembanding |
| TF-IDF Logistic Regression | 0.864268 | 0.864268 | 0.861111 | 0.732706 ± 0.071159 | Selected development artifact |
| TF-IDF LinearSVC | 0.864268 | 0.864268 | 0.861111 | 0.730400 ± 0.047621 | Tidak dipilih; tie validation |

Logistic Regression dan LinearSVC memiliki confusion matrix validation yang sama (baris aktual/kolom prediksi: Inventory `[7,2,0,0]`, Sales `[0,9,0,0]`, Service `[0,1,7,1]`, Administration `[0,1,0,8]`). Per-class F1 Logistic: Inventory 0.875000, Sales 0.818182, Service 0.875000, Administration 0.888889.

Kesalahan Logistic pada validation berjumlah lima: dua catatan kekurangan kiriman/penerimaan stok diprediksi `SALES`; satu permintaan penanganan paket khusus `SERVICE` diprediksi `SALES`; satu pembagian tugas pelayanan `SERVICE` diprediksi `ADMINISTRATION`; dan satu usulan harga yang menunggu persetujuan `ADMINISTRATION` diprediksi `SALES`. Pola ini konsisten dengan multi-topik dan vocabulary lintas kategori yang telah ditandai dalam laporan kualitas. Ia bukan dasar untuk mengubah frozen hold-out atau menambah contoh berdasarkan test.

## Seleksi dan artefak

Kandidat dipilih atas macro-F1 validation. Dalam hasil seri, Logistic Regression diprioritaskan karena menyediakan probabilitas model, bukan karena skor akhir lebih tinggi. Artefak development lokal: `services/ml/models/activity_category_v02/activity_category_v02.joblib` dan `activity_category_v02_evaluation.json`. Versi model: `activity-category-v0.2-39098d6f4f26`.

Artefak berstatus `DEVELOPMENT_ONLY`: ia tidak siap demonstrasi produk, tidak siap produksi, tidak terintegrasi dengan Express/React, dan tidak berwenang memutasi data bisnis. Artifact v0.1 tetap dipertahankan terpisah dan tidak ditimpa.

## Final gate

Final hold-out kemudian dieksekusi satu kali pada CP6-AI-DS-01H setelah konfirmasi ketua tim tentang konsensus internal. Hasil lengkap tersimpan pada [evaluasi final](ACTIVITY_FINAL_HOLDOUT_EVALUATION_V0_2.md). Hasil final tidak memicu pemilihan ulang kandidat, hyperparameter, label, atau split.

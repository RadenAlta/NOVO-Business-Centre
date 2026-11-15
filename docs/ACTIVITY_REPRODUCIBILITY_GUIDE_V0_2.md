# Panduan Reproduksi Dataset Aktivitas F4 v0 2

Prasyarat: Python 3.12 dan environment `services/ml/.venv`. Perintah berikut hanya menghasilkan/memvalidasi data sintetis; ia tidak mengakses database, cloud, atau data NOVO nyata.

```powershell
Set-Location C:\Users\raden\dev\projects\NOVO-Business-Centre\services\ml
& .\.venv\Scripts\python.exe -m pytest -q tests\test_activity_dataset.py tests\test_activity_training.py
& .\.venv\Scripts\python.exe -c "from app.activity_dataset import generate_synthetic_activity_records,split_manifest; import json; print(json.dumps(split_manifest(generate_synthetic_activity_records(seed=20261105)), ensure_ascii=False, indent=2))"
```

Expected v0.2 manifest has 144 rows, hash `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47`, and train/validation/test totals 72/36/36. Regenerating a different seed changes IDs/timestamps/hash and constitutes a different experimental dataset; do not compare metrics across it as if it were the frozen baseline.

Training is intentionally out of scope for CP6-AI-DS-01D. Before CP6-AI-DS-01E, a reviewer must approve the taxonomy, checklist, manifest, and final hold-out. Never overwrite `services/ml/models/activity_category_evaluation.json` merely to obtain an improved metric.

CP6-AI-DS-01E telah menjalankan training development dengan artefak terpisah:

```powershell
Set-Location C:\Users\raden\dev\projects\NOVO-Business-Centre\services\ml
& .\.venv\Scripts\python.exe scripts\train_activity_models.py --model-dir models\activity_category_v02 --seed 20261105
```

Perintah tersebut tidak mengevaluasi frozen final hold-out. Hasil disimpan di `models/activity_category_v02/`; artefak v0.1 di `models/` tetap tidak ditimpa. Final hold-out memerlukan catatan `INTERNAL_REVIEW_APPROVED` yang nyata, bukan perubahan flag lokal semata.

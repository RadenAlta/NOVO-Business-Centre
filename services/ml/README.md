# NOVO ML service

This FastAPI service trains two original models at first start from labelled synthetic examples that are generated in the repository. It does not download or use a pre-trained classifier as a substitute for training.

- `intent`: TF-IDF + Logistic Regression versus TF-IDF + LinearSVC, selected by held-out macro F1.
- `demand`: Ridge Regression versus Random Forest Regressor, selected by held-out RMSE.
- `activity-category`: a separate F4 demonstrator for de-identified operational notes. It compares TF-IDF + Logistic Regression with TF-IDF + LinearSVC using a grouped synthetic train/validation/test split. It is a human-reviewable category suggestion, not a financial or workflow decision engine.
- `rag`: four-intent routing, ChromaDB vector retrieval using a local sentence-transformer embedding model, then optional provider-backed generation. If generation is unconfigured, the response says it is retrieval-only; it does not pretend to be generated.

The synthetic corpus is for development/evaluation only. Replace it with consented, de-identified, documented operational data before making a production model claim.

## Run

```text
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

OpenAPI is available at `/docs`. Use `GET /v1/evaluations` to view the recorded comparisons.

## F4 activity-category reproducibility

The [activity dataset contract](../../docs/ACTIVITY_DATASET_CONTRACT.md) documents the synthetic-only schema, privacy boundary, fixed seed, grouped split, and inference response. Generate local artifacts without committing them:

```text
python scripts/train_activity_models.py --model-dir models --seed 20261105
```

The command writes `activity_category.joblib` and `activity_category_evaluation.json` below the chosen local model directory. The FastAPI service exposes `POST /v1/activity-category/predict`; its input is a de-identified note only. The existing intent model remains a separate customer-question routing task.

### Activity-only serving mode

For isolated F4 verification, set `NOVO_ML_SERVING_MODE=activity_only`. This mode loads only `NOVO_ACTIVITY_MODEL_DIR` (default `./models/activity_category_v02_final`) and requires `NOVO_ACTIVITY_MODEL_VERSION` (default `activity-category-v0.2-39098d6f4f26`) to match the final-evaluation metadata. It never calls legacy `ensure_models()` and therefore never retrains missing intent/demand artifacts during F4 startup. Legacy intent, demand, evaluation, and RAG capabilities respond as unavailable in this mode.

The default mode is `full` for backward compatibility with the existing intent/demand service behavior. Do not use it for F4 runtime verification when the legacy artifacts are absent, because the existing full-mode loader may train those artifacts.

## CPU-only CI and RAG validation

GitHub Actions installs `torch` from the official PyTorch CPU wheel index before installing this service's requirements. The workflow asserts that `torch.version.cuda is None`, imports ChromaDB and sentence-transformers, and runs the model-training and lightweight retrieval tests. This avoids CUDA/NVIDIA wheels on the standard Linux runner without removing the RAG dependencies.

The regular test suite intentionally exercises the lexical/retrieval-only fallback without downloading an embedding model. The full ChromaDB plus sentence-transformer smoke test remains an explicit validation path because it downloads the embedding model:

```text
cd services/ml
python scripts/smoke_rag_embedding.py
```

Run that command in a machine with the installed requirements and record its output before marking vector retrieval or full RAG behavior as verified.

# NOVO ML service

This FastAPI service trains two original models at first start from labelled synthetic examples that are generated in the repository. It does not download or use a pre-trained classifier as a substitute for training.

- `intent`: TF-IDF + Logistic Regression versus TF-IDF + LinearSVC, selected by held-out macro F1.
- `demand`: Ridge Regression versus Random Forest Regressor, selected by held-out RMSE.
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

## CPU-only CI and RAG validation

GitHub Actions installs `torch` from the official PyTorch CPU wheel index before installing this service's requirements. The workflow asserts that `torch.version.cuda is None`, imports ChromaDB and sentence-transformers, and runs the model-training and lightweight retrieval tests. This avoids CUDA/NVIDIA wheels on the standard Linux runner without removing the RAG dependencies.

The regular test suite intentionally exercises the lexical/retrieval-only fallback without downloading an embedding model. The full ChromaDB plus sentence-transformer smoke test remains an explicit validation path because it downloads the embedding model:

```text
cd services/ml
python scripts/smoke_rag_embedding.py
```

Run that command in a machine with the installed requirements and record its output before marking vector retrieval or full RAG behavior as verified.

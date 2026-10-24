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

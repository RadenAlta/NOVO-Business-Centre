from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .rag import answer_from_context, chroma_retrieve, lexical_retrieve
from .schemas import DemandRequest, EvaluationResponse, IntentRequest, RagRequest
from .training import TrainingResult, ensure_models

MODEL_DIR = Path(os.getenv("NOVO_MODEL_DIR", "./models"))
models: TrainingResult | None = None
app = FastAPI(title="NOVO ML Service", version="0.1.0", description="Original trained intent and demand models for NOVO Business Centre.")
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("WEB_ORIGIN", "http://localhost:5173")], allow_credentials=False, allow_methods=["POST", "GET"], allow_headers=["content-type", "authorization"])

@app.on_event("startup")
def load_models() -> None:
    global models
    models = ensure_models(MODEL_DIR)

@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "models": "loaded" if models else "loading"}

@app.get("/v1/evaluations", response_model=EvaluationResponse)
def evaluations() -> dict:
    if not models:
        raise HTTPException(503, "Models are not loaded yet.")
    return models.report

@app.post("/v1/intent/predict")
def predict_intent(request: IntentRequest) -> dict[str, object]:
    if not models:
        raise HTTPException(503, "Models are not loaded yet.")
    pipeline = models.intent_model
    intent = str(pipeline.predict([request.text])[0])
    confidence = None
    model = pipeline.named_steps["model"]
    if hasattr(model, "predict_proba"):
        confidence = float(np.max(pipeline.predict_proba([request.text])[0]))
    return {"intent": intent, "confidence": confidence, "model": next(item["model"] for item in models.report["intent"] if item["selected"])}

@app.post("/v1/demand/predict")
def predict_demand(request: DemandRequest) -> dict[str, object]:
    if not models:
        raise HTTPException(503, "Models are not loaded yet.")
    row = pd.DataFrame([request.model_dump()])
    prediction = max(0.0, float(models.demand_model.predict(row)[0]))
    return {"predicted_daily_demand": round(prediction, 1), "unit": "synthetic rider-demand proxy", "model": next(item["model"] for item in models.report["demand"] if item["selected"]), "caveat": "Development model trained on synthetic data only."}

@app.post("/v1/rag/answer")
async def rag_answer(request: RagRequest) -> dict[str, object]:
    intent_response = predict_intent(IntentRequest(text=request.question))
    intent = str(intent_response["intent"])
    if intent == "COMPLAINT":
        return {"answer": "Maaf atas kendalanya. Keluhan Anda perlu ditindaklanjuti petugas operasional. Sertakan nomor transaksi, waktu kejadian, dan kontak yang dapat dihubungi.", "sources": [], "intent": intent, "retrievalMode": "human_escalation"}
    records = [document.model_dump() for document in request.documents]
    try:
        passages = chroma_retrieve(request.question, records)
        retrieval = "chroma_vector"
    except Exception:
        passages = lexical_retrieve(request.question, records)
        retrieval = "lexical_fallback"
    answer, generation = await answer_from_context(request.question, passages)
    return {"answer": answer, "sources": [item["title"] for item in passages], "intent": intent, "retrievalMode": f"{retrieval}+{generation}"}

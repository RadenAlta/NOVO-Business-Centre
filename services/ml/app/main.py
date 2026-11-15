from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, cast

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .activity_training import ActivityArtifactUnavailable, ActivityTrainingResult, load_final_activity_model, predict_activity_category
from .rag import answer_from_context, chroma_retrieve, lexical_retrieve
from .schemas import ActivityCategoryRequest, ActivityCategoryResponse, DemandRequest, EvaluationResponse, IntentRequest, RagRequest
from .training import TrainingResult, ensure_models

MODEL_DIR = Path(os.getenv("NOVO_MODEL_DIR", "./models"))
ACTIVITY_MODEL_DIR = Path(os.getenv("NOVO_ACTIVITY_MODEL_DIR", "./models/activity_category_v02_final"))
ACTIVITY_MODEL_VERSION = os.getenv("NOVO_ACTIVITY_MODEL_VERSION", "activity-category-v0.2-39098d6f4f26")
SERVING_MODE = os.getenv("NOVO_ML_SERVING_MODE", "full").strip().lower()
models: TrainingResult | None = None
activity_models: ActivityTrainingResult | None = None
activity_model_available = False
legacy_models_available = False
app = FastAPI(title="NOVO ML Service", version="0.1.0", description="Original trained intent and demand models for NOVO Business Centre.")
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("WEB_ORIGIN", "http://localhost:5173")], allow_credentials=False, allow_methods=["POST", "GET"], allow_headers=["content-type", "authorization"])

def parse_serving_mode(value: str) -> Literal["full", "activity_only"]:
    normalized = value.strip().lower()
    if normalized not in {"full", "activity_only"}:
        raise RuntimeError("NOVO_ML_SERVING_MODE must be full or activity_only")
    return cast(Literal["full", "activity_only"], normalized)


def load_model_state(
    *,
    serving_mode: Literal["full", "activity_only"],
    model_dir: Path,
    activity_model_dir: Path,
    expected_activity_model_version: str,
) -> tuple[TrainingResult | None, ActivityTrainingResult | None]:
    """Load only the capabilities enabled by the explicit serving mode.

    `activity_only` deliberately avoids ensure_models(), which otherwise trains
    missing legacy intent/demand artifacts as a startup side effect.
    """
    legacy = None if serving_mode == "activity_only" else ensure_models(model_dir)
    try:
        activity = load_final_activity_model(activity_model_dir, expected_activity_model_version)
    except (ActivityArtifactUnavailable, OSError, ValueError, KeyError):
        activity = None
    return legacy, activity


@app.on_event("startup")
def load_models() -> None:
    global activity_model_available, activity_models, legacy_models_available, models
    mode = parse_serving_mode(SERVING_MODE)
    models, activity_models = load_model_state(
        serving_mode=mode,
        model_dir=MODEL_DIR,
        activity_model_dir=ACTIVITY_MODEL_DIR,
        expected_activity_model_version=ACTIVITY_MODEL_VERSION,
    )
    activity_model_available = activity_models is not None
    legacy_models_available = models is not None

@app.get("/healthz")
def health() -> dict[str, str]:
    mode = parse_serving_mode(SERVING_MODE)
    required_capability_available = activity_model_available if mode == "activity_only" else legacy_models_available
    return {
        "status": "ok" if required_capability_available else "degraded",
        "serving_mode": mode,
        "models": "loaded" if legacy_models_available else "unavailable",
        "activity_model": "loaded" if activity_model_available else "unavailable",
    }

@app.get("/v1/evaluations", response_model=EvaluationResponse)
def evaluations() -> dict:
    if not models:
        raise HTTPException(503, "Legacy model capability is unavailable in the current serving mode.")
    return models.report

@app.post("/v1/intent/predict")
def predict_intent(request: IntentRequest) -> dict[str, object]:
    if not models:
        raise HTTPException(503, "Legacy model capability is unavailable in the current serving mode.")
    pipeline = models.intent_model
    intent = str(pipeline.predict([request.text])[0])
    confidence = None
    model = pipeline.named_steps["model"]
    if hasattr(model, "predict_proba"):
        confidence = float(np.max(pipeline.predict_proba([request.text])[0]))
    return {"intent": intent, "confidence": confidence, "model": next(item["model"] for item in models.report["intent"] if item["selected"])}


@app.post("/v1/activity-category/predict", response_model=ActivityCategoryResponse)
def predict_activity(request: ActivityCategoryRequest) -> dict[str, object]:
    """Return a human-reviewable F4 category suggestion for a safe note."""
    if not activity_models:
        raise HTTPException(503, "Activity category model is unavailable.")
    return predict_activity_category(request.note_deidentified, activity_models)

@app.post("/v1/demand/predict")
def predict_demand(request: DemandRequest) -> dict[str, object]:
    if not models:
        raise HTTPException(503, "Legacy model capability is unavailable in the current serving mode.")
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

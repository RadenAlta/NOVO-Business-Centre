from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import f1_score, mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

INTENT_CORPUS: dict[str, list[str]] = {
    "PRODUCT": [
        "produk apa yang tersedia di toko", "berapa harga snack box", "stok minuman masih ada", "saya ingin tahu harga alat tulis",
        "apakah toko menjual buku", "cek ketersediaan seragam", "produk yang paling murah apa", "tolong cari harga makanan",
    ],
    "BOOKING": [
        "bagaimana daftar shuttle", "saya mau berlangganan rute utara", "jadwal antar jemput kapan", "pesan catering untuk hari jumat",
        "cara membuat pesanan katering", "shuttle masih menerima anggota", "ubah rute langganan saya", "kapan catering dikirim",
    ],
    "COMPLAINT": [
        "saya kecewa pesanan terlambat", "supir shuttle tidak datang", "makanan saya salah", "saya ingin komplain layanan",
        "tagihan saya keliru", "stok yang diterima rusak", "tolong laporkan masalah ini", "pelayanan kasir buruk",
    ],
    "PAYMENT": [
        "bagaimana membayar invoice", "cek status pembayaran shuttle", "saya sudah transfer tagihan", "nomor referensi pembayaran dimana",
        "berapa saldo simpanan saya", "cara setor tabungan", "pembayaran saya belum tercatat", "kapan angsuran jatuh tempo",
    ],
}

@dataclass(frozen=True)
class TrainingResult:
    intent_model: Pipeline
    demand_model: object
    report: dict


def intent_frame() -> pd.DataFrame:
    rows = [{"text": text, "intent": intent} for intent, texts in INTENT_CORPUS.items() for text in texts]
    return pd.DataFrame(rows)


def demand_frame(seed: int = 42, rows: int = 480) -> pd.DataFrame:
    """Synthetic, reproducible development data. It is not real rider demand."""
    rng = np.random.default_rng(seed)
    day = rng.integers(0, 7, size=rows)
    month = rng.integers(1, 13, size=rows)
    subscriptions = rng.integers(40, 260, size=rows)
    promotion = rng.integers(0, 2, size=rows)
    weekend_effect = np.where(day >= 5, -14, 6)
    seasonal_effect = np.where(np.isin(month, [6, 7, 12]), 18, 0)
    demand = 12 + 0.68 * subscriptions + 20 * promotion + weekend_effect + seasonal_effect + rng.normal(0, 11, size=rows)
    return pd.DataFrame({"day_of_week": day, "month": month, "active_subscriptions": subscriptions, "promotion": promotion, "demand": demand.clip(0)})


def train_all(model_dir: Path) -> TrainingResult:
    model_dir.mkdir(parents=True, exist_ok=True)
    intent = intent_frame()
    x_train, x_test, y_train, y_test = train_test_split(intent["text"], intent["intent"], test_size=0.25, random_state=42, stratify=intent["intent"])
    candidates: dict[str, Pipeline] = {
        "tfidf_logistic_regression": Pipeline([("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1)), ("model", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42))]),
        "tfidf_linear_svc": Pipeline([("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1)), ("model", LinearSVC(class_weight="balanced", random_state=42))]),
    }
    intent_scores: dict[str, float] = {}
    for name, candidate in candidates.items():
        candidate.fit(x_train, y_train)
        intent_scores[name] = float(f1_score(y_test, candidate.predict(x_test), average="macro"))
    chosen_intent_name = max(intent_scores, key=intent_scores.get)
    chosen_intent = candidates[chosen_intent_name].fit(intent["text"], intent["intent"])

    demand = demand_frame()
    features = ["day_of_week", "month", "active_subscriptions", "promotion"]
    x_train_d, x_test_d, y_train_d, y_test_d = train_test_split(demand[features], demand["demand"], test_size=0.2, random_state=42)
    demand_candidates = {
        "ridge_regression": Ridge(alpha=1.0),
        "random_forest_regressor": RandomForestRegressor(n_estimators=180, min_samples_leaf=3, random_state=42),
    }
    demand_scores: dict[str, float] = {}
    for name, candidate in demand_candidates.items():
        candidate.fit(x_train_d, y_train_d)
        demand_scores[name] = float(mean_squared_error(y_test_d, candidate.predict(x_test_d)) ** 0.5)
    chosen_demand_name = min(demand_scores, key=demand_scores.get)
    chosen_demand = demand_candidates[chosen_demand_name].fit(demand[features], demand["demand"])

    report = {
        "trained_on": "Synthetic, reproducible NOVO development corpus generated in services/ml/app/training.py",
        "intent": [{"model": name, "metric": "macro_f1", "value": round(score, 4), "selected": name == chosen_intent_name} for name, score in intent_scores.items()],
        "demand": [{"model": name, "metric": "rmse", "value": round(score, 4), "selected": name == chosen_demand_name} for name, score in demand_scores.items()],
        "caveat": "Metrics are hold-out results on synthetic development data. They do not establish production quality.",
    }
    joblib.dump(chosen_intent, model_dir / "intent.joblib")
    joblib.dump(chosen_demand, model_dir / "demand.joblib")
    (model_dir / "evaluations.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return TrainingResult(chosen_intent, chosen_demand, report)


def ensure_models(model_dir: Path) -> TrainingResult:
    intent_path, demand_path, report_path = model_dir / "intent.joblib", model_dir / "demand.joblib", model_dir / "evaluations.json"
    if not (intent_path.exists() and demand_path.exists() and report_path.exists()):
        return train_all(model_dir)
    return TrainingResult(joblib.load(intent_path), joblib.load(demand_path), json.loads(report_path.read_text(encoding="utf-8")))

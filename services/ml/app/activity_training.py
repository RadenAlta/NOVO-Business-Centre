"""Reproducible F4 activity-category training and inference.

This is intentionally independent from the existing intent and demand models.
Its output is only a human-reviewable categorisation suggestion.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence
import json
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import StratifiedGroupKFold, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

from .activity_dataset import (
    ACTIVITY_CATEGORIES,
    DATASET_VERSION,
    LABEL_VERSION,
    ActivityDatasetError,
    assert_leakage_safe,
    class_distribution,
    dataset_sha256,
    generate_synthetic_activity_records,
    normalize_note,
    validate_activity_records,
)


ACTIVITY_ARTIFACT = "activity_category_v02.joblib"
ACTIVITY_EVALUATION = "activity_category_v02_evaluation.json"
ACTIVITY_TASK = "activity-category-suggestion"
DEFAULT_SEED = 20261105


class ActivityArtifactUnavailable(RuntimeError):
    """No activity model artifact is available and automatic training was disabled."""


@dataclass(frozen=True)
class ActivityTrainingResult:
    model: Pipeline
    report: dict[str, Any]


def _metrics(labels: Sequence[str], predicted: Sequence[str]) -> dict[str, Any]:
    precision, recall, f1, support = precision_recall_fscore_support(
        labels,
        predicted,
        labels=list(ACTIVITY_CATEGORIES),
        average=None,
        zero_division=0,
    )
    _, _, macro_f1, _ = precision_recall_fscore_support(labels, predicted, average="macro", zero_division=0)
    _, _, weighted_f1, _ = precision_recall_fscore_support(labels, predicted, average="weighted", zero_division=0)
    return {
        "macro_f1": round(float(macro_f1), 6),
        "weighted_f1": round(float(weighted_f1), 6),
        "accuracy": round(float(accuracy_score(labels, predicted)), 6),
        "per_class": {
            label: {
                "precision": round(float(precision[index]), 6),
                "recall": round(float(recall[index]), 6),
                "f1": round(float(f1[index]), 6),
                "support": int(support[index]),
            }
            for index, label in enumerate(ACTIVITY_CATEGORIES)
        },
        "confusion_matrix_labels": list(ACTIVITY_CATEGORIES),
        "confusion_matrix": confusion_matrix(labels, predicted, labels=list(ACTIVITY_CATEGORIES)).tolist(),
    }


def _split_frame(records: Sequence[Mapping[str, Any]]) -> pd.DataFrame:
    validated = validate_activity_records(records)
    assert_leakage_safe(validated)
    frame = pd.DataFrame(validated)
    for split in ("TRAIN", "VALIDATION", "TEST"):
        labels = set(frame.loc[frame["split"] == split, "category_label"])
        if labels != set(ACTIVITY_CATEGORIES):
            raise ActivityDatasetError(f"{split} must contain every activity category exactly through its grouped families")
    return frame


def _candidate_models(seed: int) -> dict[str, Pipeline]:
    return {
        "dummy_most_frequent": Pipeline(
            [("tfidf", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)), ("model", DummyClassifier(strategy="most_frequent"))]
        ),
        "tfidf_logistic_regression": Pipeline(
            [("tfidf", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)), ("model", LogisticRegression(max_iter=3000, class_weight="balanced", random_state=seed))]
        ),
        "tfidf_linear_svc": Pipeline(
            [("tfidf", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)), ("model", LinearSVC(class_weight="balanced", random_state=seed))]
        ),
    }


def _group_cross_validation(candidate: Pipeline, train: pd.DataFrame, seed: int) -> dict[str, Any]:
    """Measure development stability without fitting vocabulary outside each fold."""
    groups = train["template_family"].tolist()
    splitter = StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=seed)
    scores = cross_validate(
        candidate,
        train["note_deidentified"],
        train["category_label"],
        groups=groups,
        cv=splitter,
        scoring={"macro_f1": "f1_macro", "weighted_f1": "f1_weighted", "accuracy": "accuracy"},
        error_score="raise",
    )
    return {
        metric: {
            "mean": round(float(np.mean(scores[f"test_{metric}"])), 6),
            "std": round(float(np.std(scores[f"test_{metric}"])), 6),
            "folds": [round(float(value), 6) for value in scores[f"test_{metric}"]],
        }
        for metric in ("macro_f1", "weighted_f1", "accuracy")
    }


def train_activity_models(
    model_dir: Path,
    records: Sequence[Mapping[str, Any]] | None = None,
    seed: int = DEFAULT_SEED,
    *,
    final_holdout_permitted: bool = False,
    internal_review_status: str = "INTERNAL_REVIEW_PENDING",
) -> ActivityTrainingResult:
    """Train development candidates and protect the frozen test split by default."""
    if final_holdout_permitted and internal_review_status != "INTERNAL_REVIEW_APPROVED":
        raise ValueError("final hold-out requires explicit INTERNAL_REVIEW_APPROVED status")
    source_records = list(records) if records is not None else generate_synthetic_activity_records(seed=seed)
    frame = _split_frame(source_records)
    train = frame.loc[frame["split"] == "TRAIN"]
    validation = frame.loc[frame["split"] == "VALIDATION"]
    test = frame.loc[frame["split"] == "TEST"]
    candidates = _candidate_models(seed)
    candidate_reports: dict[str, dict[str, Any]] = {}
    refit_models: dict[str, Pipeline] = {}
    for name, candidate in candidates.items():
        candidate.fit(train["note_deidentified"], train["category_label"])
        validation_prediction = candidate.predict(validation["note_deidentified"])
        validation_metrics = _metrics(validation["category_label"].tolist(), validation_prediction.tolist())
        refit = _candidate_models(seed)[name]
        combined = pd.concat([train, validation], ignore_index=True)
        refit.fit(combined["note_deidentified"], combined["category_label"])
        candidate_reports[name] = {
            "validation": validation_metrics,
            "validation_error_analysis": [
                {
                    "activity_id": str(row.activity_id),
                    "actual": str(row.category_label),
                    "predicted": str(predicted),
                    "note": str(row.note_deidentified),
                }
                for row, predicted in zip(validation.itertuples(index=False), validation_prediction)
                if row.category_label != predicted
            ],
            "development_group_cv": _group_cross_validation(_candidate_models(seed)[name], train, seed),
        }
        if final_holdout_permitted:
            test_prediction = refit.predict(test["note_deidentified"])
            candidate_reports[name]["final_holdout"] = _metrics(test["category_label"].tolist(), test_prediction.tolist())
        refit_models[name] = refit
    selected_name = max(
        candidates,
        key=lambda name: (candidate_reports[name]["validation"]["macro_f1"], name == "tfidf_logistic_regression"),
    )
    selected_model = refit_models[selected_name]
    record_hash = dataset_sha256(source_records)
    model_version = f"activity-category-v0.2-{record_hash[:12]}"
    final_holdout: dict[str, Any] = {"status": "WAITING_INTERNAL_REVIEW", "metrics": None, "error_analysis": []}
    if final_holdout_permitted:
        selected_test_predictions = selected_model.predict(test["note_deidentified"])
        final_holdout = {
            "status": "FINAL_HOLDOUT_EXECUTED",
            "metrics": _metrics(test["category_label"].tolist(), selected_test_predictions.tolist()),
            "error_analysis": [
                {"activity_id": str(row.activity_id), "actual": str(row.category_label), "predicted": str(predicted), "note": str(row.note_deidentified)}
                for row, predicted in zip(test.itertuples(index=False), selected_test_predictions)
                if row.category_label != predicted
            ],
        }
    report: dict[str, Any] = {
        "task": ACTIVITY_TASK,
        "model_version": model_version,
        "dataset_version": DATASET_VERSION,
        "label_version": LABEL_VERSION,
        "seed": seed,
        "dataset_sha256": record_hash,
        "dataset_provenance": sorted(set(record["provenance"] for record in source_records)),
        "split_strategy": "template-family-grouped fixed split; validation selects model; final hold-out remains frozen unless explicitly released after internal review",
        "class_distribution": {split: class_distribution(frame.loc[frame["split"] == split].to_dict("records")) for split in ("TRAIN", "VALIDATION", "TEST")},
        "candidates": candidate_reports,
        "selected_model": selected_name,
        "selection_rationale": "highest validation macro-F1; ties prefer tfidf_logistic_regression for calibrated probability support",
        "final_holdout": final_holdout,
        "internal_review_status": internal_review_status,
        "environment": {"python": sys.version.split()[0], "scikit_learn": __import__("sklearn").__version__},
        "caveats": [
            "Synthetic development data only; metrics do not establish production quality.",
            "Predictions are category suggestions for human review and never mutate operational or financial data.",
            "LinearSVC decision scores are not calibrated probabilities.",
            "Selected artifact is DEVELOPMENT_ONLY until the frozen final hold-out gate and application integration are separately accepted.",
        ],
    }
    model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(selected_model, model_dir / ACTIVITY_ARTIFACT)
    (model_dir / ACTIVITY_EVALUATION).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return ActivityTrainingResult(model=selected_model, report=report)


def load_activity_model(model_dir: Path) -> ActivityTrainingResult:
    artifact, evaluation = model_dir / ACTIVITY_ARTIFACT, model_dir / ACTIVITY_EVALUATION
    if not artifact.exists() or not evaluation.exists():
        raise ActivityArtifactUnavailable("activity model artifact or evaluation metadata is unavailable")
    return ActivityTrainingResult(model=joblib.load(artifact), report=json.loads(evaluation.read_text(encoding="utf-8")))


def load_final_activity_model(
    model_dir: Path,
    expected_model_version: str | None = None,
) -> ActivityTrainingResult:
    """Load only an explicitly evaluated F4 artifact; never train a fallback."""
    loaded = load_activity_model(model_dir)
    final_holdout = loaded.report.get("final_holdout")
    if (
        not isinstance(final_holdout, dict)
        or final_holdout.get("status") != "FINAL_HOLDOUT_EXECUTED"
        or loaded.report.get("internal_review_status") != "INTERNAL_REVIEW_APPROVED"
    ):
        raise ActivityArtifactUnavailable(
            "activity model artifact is not an internally approved final evaluation artifact"
        )
    if expected_model_version and loaded.report.get("model_version") != expected_model_version:
        raise ActivityArtifactUnavailable(
            "activity model artifact does not match the configured final model version"
        )
    return loaded


def ensure_activity_model(model_dir: Path, seed: int = DEFAULT_SEED) -> ActivityTrainingResult:
    try:
        return load_activity_model(model_dir)
    except ActivityArtifactUnavailable:
        return train_activity_models(model_dir, seed=seed)


def predict_activity_category(text: str, trained: ActivityTrainingResult) -> dict[str, Any]:
    normalized = normalize_note(text)
    if len(normalized) < 3:
        raise ValueError("activity note must contain at least three non-whitespace characters")
    predicted = str(trained.model.predict([normalized])[0])
    estimator = trained.model.named_steps["model"]
    confidence: float | None = None
    decision_score: float | None = None
    if hasattr(estimator, "predict_proba"):
        confidence = round(float(np.max(trained.model.predict_proba([normalized])[0])), 6)
    elif hasattr(estimator, "decision_function"):
        raw_score = trained.model.decision_function([normalized])
        decision_score = round(float(np.max(np.asarray(raw_score))), 6)
    return {
        "predicted_category": predicted,
        "confidence": confidence,
        "decision_score": decision_score,
        "model_version": trained.report["model_version"],
        "label_version": trained.report["label_version"],
        "inference_status": "ok",
    }

from pathlib import Path
from shutil import copy2

import pytest
from fastapi import HTTPException

from app import main
from app.activity_training import load_final_activity_model
from app.schemas import ActivityCategoryRequest


FINAL_MODEL_VERSION = "activity-category-v0.2-39098d6f4f26"


def final_artifact_dir() -> Path:
    return Path(__file__).parents[1] / "models" / "activity_category_v02_final"


def test_activity_only_mode_never_loads_or_trains_legacy_models(monkeypatch: pytest.MonkeyPatch) -> None:
    def legacy_training_must_not_run(_: Path) -> object:
        raise AssertionError("activity_only must not call ensure_models")

    monkeypatch.setattr(main, "ensure_models", legacy_training_must_not_run)

    legacy, activity = main.load_model_state(
        serving_mode="activity_only",
        model_dir=Path("unused-legacy-model-directory"),
        activity_model_dir=final_artifact_dir(),
        expected_activity_model_version=FINAL_MODEL_VERSION,
    )

    assert legacy is None
    assert activity is not None
    assert activity.report["model_version"] == FINAL_MODEL_VERSION


def test_activity_only_mode_fails_closed_for_missing_or_mismatched_final_artifact(tmp_path: Path) -> None:
    missing_legacy, missing_activity = main.load_model_state(
        serving_mode="activity_only",
        model_dir=tmp_path / "legacy",
        activity_model_dir=tmp_path / "missing-final",
        expected_activity_model_version=FINAL_MODEL_VERSION,
    )
    assert missing_legacy is None
    assert missing_activity is None

    mismatched_legacy, mismatched_activity = main.load_model_state(
        serving_mode="activity_only",
        model_dir=tmp_path / "legacy",
        activity_model_dir=final_artifact_dir(),
        expected_activity_model_version="activity-category-v0.2-unapproved",
    )
    assert mismatched_legacy is None
    assert mismatched_activity is None


def test_invalid_final_metadata_fails_closed_without_touching_the_approved_artifact(tmp_path: Path) -> None:
    copied = tmp_path / "copied-final"
    copied.mkdir()
    copy2(final_artifact_dir() / "activity_category_v02.joblib", copied / "activity_category_v02.joblib")
    (copied / "activity_category_v02_evaluation.json").write_text("not valid json", encoding="utf-8")

    legacy, activity = main.load_model_state(
        serving_mode="activity_only",
        model_dir=tmp_path / "legacy",
        activity_model_dir=copied,
        expected_activity_model_version=FINAL_MODEL_VERSION,
    )
    assert legacy is None
    assert activity is None
    assert (final_artifact_dir() / "activity_category_v02_evaluation.json").exists()


def test_activity_endpoint_returns_the_final_contract_and_legacy_capabilities_fail_clearly(monkeypatch: pytest.MonkeyPatch) -> None:
    approved = load_final_activity_model(final_artifact_dir(), FINAL_MODEL_VERSION)
    monkeypatch.setattr(main, "activity_models", approved)
    monkeypatch.setattr(main, "activity_model_available", True)
    monkeypatch.setattr(main, "models", None)
    monkeypatch.setattr(main, "legacy_models_available", False)

    response = main.predict_activity(
        ActivityCategoryRequest(note_deidentified="Petugas memeriksa stok barang sebelum toko dibuka."),
    )
    assert response["predicted_category"] in {"INVENTORY", "SALES", "SERVICE", "ADMINISTRATION"}
    assert response["model_version"] == FINAL_MODEL_VERSION
    assert response["inference_status"] == "ok"

    with pytest.raises(HTTPException) as failure:
        main.evaluations()
    assert failure.value.status_code == 503
    assert "Legacy model capability" in str(failure.value.detail)


def test_activity_only_health_reports_actual_f4_readiness(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "SERVING_MODE", "activity_only")
    monkeypatch.setattr(main, "activity_model_available", True)
    monkeypatch.setattr(main, "legacy_models_available", False)
    assert main.health() == {
        "status": "ok",
        "serving_mode": "activity_only",
        "models": "unavailable",
        "activity_model": "loaded",
    }

    monkeypatch.setattr(main, "activity_model_available", False)
    assert main.health()["status"] == "degraded"


def test_invalid_serving_mode_is_rejected_explicitly() -> None:
    with pytest.raises(RuntimeError, match="NOVO_ML_SERVING_MODE"):
        main.parse_serving_mode("training_fallback")

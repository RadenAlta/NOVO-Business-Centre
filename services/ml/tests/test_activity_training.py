from pathlib import Path

import pytest

from app.activity_dataset import ACTIVITY_CATEGORIES, generate_synthetic_activity_records
from app.activity_training import ActivityArtifactUnavailable, load_activity_model, load_final_activity_model, predict_activity_category, train_activity_models


def test_activity_training_compares_two_models_and_writes_reproducible_evidence(tmp_path: Path) -> None:
    result = train_activity_models(tmp_path, records=generate_synthetic_activity_records(seed=123), seed=123)

    assert set(result.report["candidates"]) == {"dummy_most_frequent", "tfidf_logistic_regression", "tfidf_linear_svc"}
    assert result.report["selected_model"] in result.report["candidates"]
    assert result.report["dataset_sha256"]
    assert result.report["class_distribution"]["TEST"] == {label: 9 for label in ACTIVITY_CATEGORIES}
    assert result.report["final_holdout"]["status"] == "WAITING_INTERNAL_REVIEW"
    assert result.report["final_holdout"]["metrics"] is None
    assert result.report["candidates"]["dummy_most_frequent"]["development_group_cv"]["macro_f1"]["folds"]
    assert (tmp_path / "activity_category_v02.joblib").exists()
    assert (tmp_path / "activity_category_v02_evaluation.json").exists()
    assert load_activity_model(tmp_path).report["model_version"] == result.report["model_version"]


def test_activity_inference_returns_a_score_or_probability_with_version_metadata(tmp_path: Path) -> None:
    trained = train_activity_models(tmp_path, records=generate_synthetic_activity_records(seed=321), seed=321)
    result = predict_activity_category("Catatan gudang menunjukkan barang perlu diperiksa sebelum toko buka.", trained)

    assert result["predicted_category"] in ACTIVITY_CATEGORIES
    assert result["inference_status"] == "ok"
    assert result["model_version"] == trained.report["model_version"]
    assert result["label_version"] == trained.report["label_version"]
    assert (result["confidence"] is None) != (result["decision_score"] is None)
    with pytest.raises(ValueError, match="non-whitespace"):
        predict_activity_category("   ", trained)


def test_loading_fails_explicitly_when_activity_artifacts_are_unavailable(tmp_path: Path) -> None:
    with pytest.raises(ActivityArtifactUnavailable, match="unavailable"):
        load_activity_model(tmp_path)


def test_final_holdout_cannot_run_without_explicit_internal_review_approval(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="INTERNAL_REVIEW_APPROVED"):
        train_activity_models(tmp_path, final_holdout_permitted=True)


def test_final_serving_loader_rejects_development_artifacts_and_never_trains_a_fallback(tmp_path: Path) -> None:
    train_activity_models(tmp_path, records=generate_synthetic_activity_records(seed=456), seed=456)

    with pytest.raises(ActivityArtifactUnavailable, match="approved final"):
        load_final_activity_model(tmp_path)


def test_final_serving_loader_rejects_an_unexpected_model_version(tmp_path: Path) -> None:
    trained = train_activity_models(
        tmp_path,
        records=generate_synthetic_activity_records(seed=457),
        seed=457,
        final_holdout_permitted=True,
        internal_review_status="INTERNAL_REVIEW_APPROVED",
    )

    with pytest.raises(ActivityArtifactUnavailable, match="configured final model version"):
        load_final_activity_model(tmp_path, expected_model_version=f"{trained.report['model_version']}-different")

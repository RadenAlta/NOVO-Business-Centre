from pathlib import Path
from app.training import ensure_models, intent_frame

def test_training_compares_two_models(tmp_path: Path) -> None:
    trained = ensure_models(tmp_path)
    assert len(trained.report["intent"]) == 2
    assert len(trained.report["demand"]) == 2
    assert sum(item["selected"] for item in trained.report["intent"]) == 1
    assert sum(item["selected"] for item in trained.report["demand"]) == 1

def test_intent_training_has_four_supported_flows() -> None:
    assert set(intent_frame()["intent"].unique()) == {"PRODUCT", "BOOKING", "COMPLAINT", "PAYMENT"}

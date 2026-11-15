from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.activity_dataset import (
    ACTIVITY_CATEGORIES,
    ActivityDatasetError,
    assert_leakage_safe,
    dataset_quality_report,
    generate_synthetic_activity_records,
    split_manifest,
    validate_activity_records,
)
from app.schemas import ActivityCategoryRequest, ActivityCategoryResponse


def test_synthetic_generation_is_reproducible_and_contract_valid() -> None:
    first = generate_synthetic_activity_records(seed=77)
    second = generate_synthetic_activity_records(seed=77)

    assert first == second
    assert len(validate_activity_records(first)) == len(first)
    assert {item["split"] for item in first} == {"TRAIN", "VALIDATION", "TEST"}
    assert len(first) == 144
    assert {item["review_status"] for item in first} == {"CLEAR", "AMBIGUOUS_REVIEWED"}


def test_v02_split_manifest_has_frozen_grouped_holdout_and_balanced_scenarios() -> None:
    records = generate_synthetic_activity_records(seed=20261105)
    manifest = split_manifest(records)

    assert manifest["record_count"] == 144
    assert len(manifest["families_by_split"]["TRAIN"]) == 24
    assert len(manifest["families_by_split"]["VALIDATION"]) == 12
    assert len(manifest["frozen_final_holdout"]) == 12
    assert manifest["class_distribution"]["TRAIN"] == {label: 18 for label in ACTIVITY_CATEGORIES}
    assert manifest["class_distribution"]["VALIDATION"] == {label: 9 for label in ACTIVITY_CATEGORIES}
    assert manifest["class_distribution"]["TEST"] == {label: 9 for label in ACTIVITY_CATEGORIES}


def test_dataset_rejects_empty_notes_and_invalid_labels() -> None:
    records = generate_synthetic_activity_records(seed=88)
    empty = deepcopy(records)
    empty[0]["note_deidentified"] = "   "
    with pytest.raises(ActivityDatasetError, match="note_deidentified"):
        validate_activity_records(empty)

    invalid = deepcopy(records)
    invalid[0]["category_label"] = "FINANCIAL_DECISION"
    with pytest.raises(ActivityDatasetError, match="category_label"):
        validate_activity_records(invalid)


def test_dataset_rejects_contact_like_notes_missing_provenance_and_invalid_review_status() -> None:
    records = generate_synthetic_activity_records(seed=89)

    contact_like = deepcopy(records)
    contact_like[0]["note_deidentified"] = "Hubungi 0812 3456 7890 sebelum penghitungan stok dilakukan."
    with pytest.raises(ActivityDatasetError, match="contact"):
        validate_activity_records(contact_like)

    missing_provenance = deepcopy(records)
    missing_provenance[0]["provenance"] = " "
    with pytest.raises(ActivityDatasetError, match="provenance"):
        validate_activity_records(missing_provenance)

    invalid_review_status = deepcopy(records)
    invalid_review_status[0]["review_status"] = "AUTO_APPROVED"
    with pytest.raises(ActivityDatasetError, match="review_status"):
        validate_activity_records(invalid_review_status)


@pytest.mark.parametrize(
    ("note", "error_type"),
    [
        ("", "string_too_short"),
        ("  ", "string_too_short"),
        ("   ", "value_error"),
    ],
)
def test_activity_request_rejects_short_and_whitespace_only_notes(note: str, error_type: str) -> None:
    with pytest.raises(ValidationError) as failure:
        ActivityCategoryRequest(note_deidentified=note)

    error = failure.value.errors()[0]
    assert error["loc"] == ("note_deidentified",)
    assert error["type"] == error_type


def test_activity_request_accepts_and_normalizes_valid_note() -> None:
    request = ActivityCategoryRequest(note_deidentified="  Catatan layanan perlu ditindaklanjuti.  ")

    assert request.note_deidentified == "Catatan layanan perlu ditindaklanjuti."


def test_activity_response_rejects_unknown_labels_and_invalid_confidence() -> None:
    valid = ActivityCategoryResponse(
        predicted_category="SERVICE",
        confidence=0.8,
        decision_score=None,
        model_version="activity-category-v0.2-test",
        label_version="activity-category-v0.1",
        inference_status="ok",
    )
    assert valid.predicted_category == "SERVICE"

    with pytest.raises(ValidationError):
        ActivityCategoryResponse(
            predicted_category="UNKNOWN",
            confidence=None,
            decision_score=None,
            model_version="activity-category-v0.2-test",
            label_version="activity-category-v0.1",
            inference_status="ok",
        )


def test_dataset_guard_rejects_cross_split_template_or_text_leakage() -> None:
    records = generate_synthetic_activity_records(seed=99)
    leaked_family = deepcopy(records)
    leaked_family[0]["split"] = "TEST"
    with pytest.raises(ActivityDatasetError, match="template_family"):
        assert_leakage_safe(leaked_family)

    leaked_text = deepcopy(records)
    train = next(item for item in leaked_text if item["split"] == "TRAIN")
    test = next(item for item in leaked_text if item["split"] == "TEST")
    test["note_deidentified"] = train["note_deidentified"]
    with pytest.raises(ActivityDatasetError, match="duplicate note"):
        assert_leakage_safe(leaked_text)


def test_dataset_guard_rejects_near_duplicate_text_across_splits() -> None:
    records = generate_synthetic_activity_records(seed=100)
    train = next(item for item in records if item["split"] == "TRAIN")
    test = next(item for item in records if item["split"] == "TEST")
    test["note_deidentified"] = f"{train['note_deidentified']} Catatan tambahan."
    with pytest.raises(ActivityDatasetError, match="near-duplicate"):
        assert_leakage_safe(records)


def test_dataset_guard_rejects_declared_semantic_group_across_splits() -> None:
    records = generate_synthetic_activity_records(seed=101)
    train = next(item for item in records if item["split"] == "TRAIN")
    test = next(item for item in records if item["split"] == "TEST")
    test["semantic_group"] = train["semantic_group"]
    with pytest.raises(ActivityDatasetError, match="semantic_group"):
        assert_leakage_safe(records)


def test_ambiguous_examples_have_a_reviewable_primary_action() -> None:
    records = generate_synthetic_activity_records(seed=103)
    ambiguous = [item for item in records if item["review_status"] == "AMBIGUOUS_REVIEWED"]

    assert len(ambiguous) == 21
    assert len({item["template_family"] for item in ambiguous}) == 7
    assert {item["split"] for item in ambiguous} <= {"TRAIN", "VALIDATION"}
    assert all(item["primary_action"] for item in ambiguous)
    assert all(item["semantic_group"] == item["template_family"] for item in ambiguous)


def test_quality_report_exposes_human_review_signals_without_claiming_semantic_detection() -> None:
    report = dataset_quality_report(generate_synthetic_activity_records(seed=102))

    assert report["record_count"] == 144
    assert report["template_family_count"] == 48
    assert report["ambiguous_reviewed_count"] > 0
    assert set(report["label_specific_tokens_for_human_review"]) == set(ACTIVITY_CATEGORIES)

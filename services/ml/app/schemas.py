from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

class IntentRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


class ActivityCategoryRequest(BaseModel):
    """A de-identified operational note, not a transaction command."""

    note_deidentified: str = Field(min_length=3, max_length=500)

    @field_validator("note_deidentified")
    @classmethod
    def reject_blank_note(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 3:
            raise ValueError("note_deidentified must contain at least three non-whitespace characters")
        return normalized


class ActivityCategoryResponse(BaseModel):
    predicted_category: Literal["INVENTORY", "SALES", "SERVICE", "ADMINISTRATION"]
    confidence: float | None = Field(ge=0, le=1)
    decision_score: float | None = None
    model_version: str
    label_version: str
    inference_status: Literal["ok"]

    @model_validator(mode="after")
    def require_exactly_one_score(self) -> "ActivityCategoryResponse":
        if (self.confidence is None) == (self.decision_score is None):
            raise ValueError("exactly one of confidence or decision_score is required")
        return self

class DemandRequest(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    month: int = Field(ge=1, le=12)
    active_subscriptions: int = Field(ge=0, le=100000)
    promotion: int = Field(ge=0, le=1)

class KnowledgeDocument(BaseModel):
    id: str = Field(min_length=2, max_length=120)
    title: str = Field(min_length=3, max_length=160)
    content: str = Field(min_length=30, max_length=20000)

class RagRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    documents: list[KnowledgeDocument] = Field(default_factory=list, max_length=200)

class ModelEvaluation(BaseModel):
    model: str
    metric: str
    value: float
    selected: bool

class EvaluationResponse(BaseModel):
    trained_on: str
    intent: list[ModelEvaluation]
    demand: list[ModelEvaluation]
    caveat: str

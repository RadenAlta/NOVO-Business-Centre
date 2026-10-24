from datetime import date
from pydantic import BaseModel, Field

class IntentRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)

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

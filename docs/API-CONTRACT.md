# API contract

Base path: `/api/v1`. Protected endpoints accept `Authorization: Bearer <JWT>` or the `novo_session` HttpOnly cookie. Every protected query is tenant-scoped from the token, not from a client-provided tenant identifier. Errors share this shape:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Check the submitted fields.","details":{}}}
```

| Area | Endpoint | Purpose |
| --- | --- | --- |
| Auth | `POST /auth/bootstrap`, `POST /auth/login`, `POST /auth/logout`, `GET /me` | Initialise exactly one workspace, authenticate, clear browser cookie, inspect current user |
| Master data | `GET/POST/PATCH /master-data`, `PATCH /master-data/:id/active`, `GET/POST /members`, `GET/POST /products`, `POST /products/:id/adjustments` | School identity directory, cooperative-member linkage, catalog and auditable inventory movement |
| Store | `GET/POST /sales` | POS checkout atomically creates sale and negative stock movements |
| Shuttle | `GET/POST /shuttle/routes`, `GET/POST /shuttle/subscriptions`, `POST /shuttle/subscriptions/:id/invoices` | Route, subscription and billing flow |
| Billing | `GET /billing/invoices`, `POST /billing/invoices/:id/payments` | Invoice collection with overpayment guard |
| Catering | `GET/POST /catering/orders`, `PATCH /catering/orders/:id/status` | Catering order flow |
| Funding | `GET/POST /funding/accounts`, `POST /funding/accounts/:id/entries` | Savings accounts and immutable ledger entries |
| Financing | `GET/POST /financing/applications` | Application and receivable schedule creation |
| Purchasing | `GET/POST /purchasing/requests` | Explicit procurement extension |
| AI/Data | `GET /dashboard`, `POST /analytics/demand-forecast`, `GET/POST /knowledge-documents`, `POST /ai/assist`, `POST /assistant/chat` | Dashboard data, protected ML demand forecast, RAG context, provider-backed GenAI, ML-service RAG |
| Governance | `POST /attachments`, `GET /attachments/:id/download`, `GET /audit-logs` | Signature-checked attachment upload, tenant-scoped download, and audit review |

## Model-service contract

The backend calls the private FastAPI service, not the browser.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /v1/intent/predict` | `{text}` | `{intent, confidence, model}` |
| `POST /v1/demand/predict` | `{day_of_week, month, active_subscriptions, promotion}` | `{predicted_daily_demand, model, caveat}` |
| `POST /v1/rag/answer` | `{question, documents:[{id,title,content}]}` | `{answer, sources, intent, retrievalMode}` |
| `GET /v1/evaluations` | none | Hold-out comparisons for both trained model families |

The ML service returns `503` while models load and reports a retrieval-only fallback when configured generation is unavailable. Treat these as normal, visible availability states rather than silent success.

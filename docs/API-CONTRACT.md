# API contract

Base path: `/api/v1`. Browser requests authenticate **only** with the `novo_session` HttpOnly cookie. The server stores only the SHA-256 session hash, resolves the active user and role on every protected request, and derives tenant scope from that record. Browser clients must never send `Authorization: Bearer` credentials.

Errors share this shape:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Check the submitted fields.","details":{}}}
```

## Browser session and CSRF contract

| Endpoint / method | Browser requirements | Response contract |
| --- | --- | --- |
| `POST /auth/bootstrap` | JSON body and `Origin` equal to `WEB_ORIGIN` (or matching Referer fallback). | Sets `novo_session` HttpOnly cookie; returns `{user, tenant, csrfToken}` and never a session token. Only works before the first tenant exists. |
| `POST /auth/login` | JSON credentials and trusted Origin/Referer. | Sets a new opaque HttpOnly cookie; returns `{user, tenant, csrfToken}` and never a bearer token. |
| `GET /me` | Cookie only; no CSRF header. | Returns `{user, tenant, csrfToken}` with a stable session-bound CSRF value. Concurrent reads return usable equivalent values; legacy sessions are upgraded atomically. |
| `POST /auth/logout` | Trusted Origin/Referer and `X-Novo-Csrf` when the session is active. | Revokes the active server-side session, clears the cookie, and returns `204`. A missing/previously revoked cookie also returns `204`. |
| Every other `POST`, `PUT`, `PATCH`, `DELETE` | Cookie, `X-Novo-Csrf`, and trusted Origin/Referer. | Rejects missing/invalid CSRF as `403 CSRF_INVALID`; rejects an untrusted origin as `403 UNTRUSTED_ORIGIN`. |

`GET`, `HEAD`, and `OPTIONS` do not require a CSRF header. The React client uses `credentials: "include"`, stores the CSRF token only in memory, deliberately leaves multipart `FormData` content types to the browser, scopes cached protected data to tenant/user/role, and removes that cache on account change or unauthentication. Logout only clears local state after server confirmation (`204`) or an already-invalidated `401`; other failures remain visible and retryable.

| Area | Endpoint | Purpose |
| --- | --- | --- |
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
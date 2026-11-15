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

Role-gated UI must mirror server delegation rather than inventing a second authorization policy. In particular, `SUPER_ADMIN` delegates to all defined roles in `requireRoles`; the server remains the authorization boundary and every lookup still derives the tenant from the active session.

| Area | Endpoint | Purpose |
| --- | --- | --- |
| Master data | `GET/POST/PATCH /master-data`, `PATCH /master-data/:id/active`, `GET/POST /members`, `GET/POST /products` | School identity directory, cooperative-member linkage, and product catalog |
| Store | `GET/POST /sales`, `POST /sales/:id/void`, `POST /products/:id/receipts`, `POST /products/:id/adjustments`, `GET /products/:id/movements` | POS transactions, sale voids, stock receipts and adjustments, and auditable inventory history |
| Shuttle | `GET/POST /shuttle/routes`, `GET/POST /shuttle/subscriptions`, `POST /shuttle/subscriptions/:id/invoices`, billing-period, settlement, and report endpoints | Tenant-scoped route, subscription, billing, settlement, and reporting flow |
| Billing | `GET /billing/invoices`, `POST /billing/invoices/:id/payments`, `POST /billing/payments/:id/verify`, `POST /billing/payments/:id/reverse` | Invoice collection, verification, reversal, and overpayment guard |
| Catering | `GET/POST /catering/orders`, `PATCH /catering/orders/:id/status` | Catering order flow |
| Funding | `GET/POST /funding/accounts`, `POST /funding/accounts/:id/entries` | Savings accounts and immutable ledger entries |
| Financing | `GET/POST /financing/applications` | Application and receivable schedule creation |
| Purchasing | `GET/POST /purchasing/requests` | Explicit procurement extension |
| AI/Data | `GET /dashboard`, `POST /analytics/demand-forecast`, `GET/POST /knowledge-documents`, `POST /ai/assist`, `POST /assistant/chat` | Dashboard data, protected ML demand forecast, RAG context, provider-backed GenAI, ML-service RAG |
| Governance | `POST /attachments`, `GET /attachments/:id/download`, `GET /audit-logs` | Signature-checked attachment upload, tenant-scoped download, and audit review |
## Store inventory idempotency contract

Both inventory mutation endpoints use the `/api/v1` base path:

| Endpoint | Operation | Required browser headers |
| --- | --- | --- |
| `POST /products/:id/receipts` | Receive stock and record a `STOCK_RECEIPT` movement | `Idempotency-Key`, `X-Novo-Csrf`, trusted `Origin`/`Referer`, and session cookie |
| `POST /products/:id/adjustments` | Adjust stock and record a `STOCK_ADJUSTMENT` movement | `Idempotency-Key`, `X-Novo-Csrf`, trusted `Origin`/`Referer`, and session cookie |

The `Idempotency-Key` value is a trimmed ASCII string of 8-128 characters matching `[A-Za-z0-9][A-Za-z0-9._:-]{7,127}`. A missing or malformed key returns HTTP `400`.

The key is scoped to the authenticated tenant, not to an individual product or endpoint. Tenant identity is resolved from the current session. The same key can be used independently by different tenants.

Clients must generate a new key for each distinct inventory mutation and retain that key when retrying the *same* mutation. The operation, product ID, and normalized request fields contribute to a SHA-256 fingerprint. Receipt fingerprints include quantity, optional reference, and the unit-cost action/value; adjustment fingerprints include quantity, optional reference, and reason. Omitting a receipt unit-cost change is distinct from explicitly clearing its value.

| Result | HTTP status | Behaviour |
| --- | --- | --- |
| First successful mutation | `201` | Updates stock and creates one movement and audit record |
| Repeat with the same tenant, key, operation, and fingerprint | `200` | Returns the existing movement without applying stock changes or writing duplicate movement/audit records |
| Reuse of a key for different input or a different inventory operation | `409 IDEMPOTENCY_KEY_REUSED` | Rejects the conflicting mutation without changing inventory |
| Missing or invalid key | `400` | Rejects the request before performing an inventory mutation |

Inventory writes use serializable database transactions. If an attempted mutation fails and its transaction rolls back, the key is not committed and the original request can be retried.

`GET /products/:id/movements` returns tenant-scoped stock history and requires authentication, but no idempotency header. Internal `idempotencyKey` and `inputFingerprint` fields are excluded from public movement responses, including successful mutations and replays.

## Shuttle foundation contract

`GET /shuttle/routes` accepts optional `q`, `active`, `page`, and `pageSize` query parameters and returns `{ data, pagination }`. Search covers route code/name. `GET /shuttle/subscriptions` accepts optional `q`, `routeId`, `status`, `page`, and `pageSize`, returns the same envelope, and searches the current tenant's member and route fields only.

`POST /shuttle/subscriptions` rejects an `endDate` before `startDate`, a foreign or inactive route, and an ineligible current cooperative member. The permitted Shuttle subscriber identity policy remains an open business decision recorded in `SPRINT05_BUSINESS_DECISIONS.md`; this endpoint preserves the existing cooperative-member model until a reviewed migration changes it.

`POST /shuttle/subscriptions/:id/cancel` is an operations-role correction endpoint. It requires a 5–500 character reason, derives the tenant from the session, changes only an active same-tenant subscription to `CANCELLED`, and writes one `cancel` AuditLog in the same serializable transaction. A repeated cancellation is a no-op `200` response and does not write another audit entry. Existing invoices are retained as history; new ad-hoc invoices and billing-period generation reject cancelled subscriptions.

Existing Shuttle Route, Subscription, Invoice, and Payment writes now include their AuditLog record in the same serializable transaction. Payment recording retries PostgreSQL serialization conflicts and rejects an overpayment without committing either the payment or its audit record. This is a data-integrity guarantee, not an approval of billing-period, proration, share, settlement, or refund policy.

A checkout idempotency key belongs to the separate `POST /sales` contract. A sale void is not a payment refund.

## Shuttle billing and payment contract

`POST/GET /shuttle/billing-periods` creates or lists a tenant-scoped monthly period. `POST /shuttle/billing-periods/:id/generate` creates missing invoice drafts idempotently, while `POST /shuttle/billing-periods/:id/finalize` publishes draft invoices and finalizes the period. The browser must treat `409 BILLING_PERIOD_FINALIZED` as a refresh-required state, not a successful submission.

**Provisional Shuttle money boundary:** route rate, ad-hoc Shuttle invoice amount, and Shuttle payment amount must be positive whole Rupiah within the documented API range. Fractional Rupiah, non-finite values, zero/negative payment amounts, and out-of-range values are rejected with `400 VALIDATION_ERROR`; they are never rounded or truncated. Server-side payment balance, invoice status, settlement split, and Shuttle-report aggregation use exact integer arithmetic before returning ordinary JSON numbers for valid in-range values. This is a Capstone technical policy pending finance/PIC confirmation for operational data.

`GET /billing/invoices` returns invoice payment history for its permitted roles. The client derives an informational outstanding amount from **VERIFIED** payments only; the server remains authoritative for payment acceptance, invoice status, and overpayment decisions. `POST /billing/payments/:id/verify` and `POST /billing/payments/:id/reverse` are finance-role actions. A reversal after allocation returns `409 PAYMENT_ALLOCATED_TO_SETTLEMENT` without changing the payment.

**Provisional Cashier collection contract:** `GET /shuttle/billing/collectible-invoices` is a tenant-scoped, read-only selection endpoint for payment-recording roles. It accepts bounded `q`, `page`, and `pageSize` parameters and returns only invoice ID/reference, minimal rider/route/billing-period context, whole-Rupiah invoice amount, currently collectible amount, status, and due date. It does not return Payment history, settlement metadata, vendor/cooperative shares, or finance-management fields. A collectible invoice is `ISSUED`, not `VOID`, and has a positive balance after both `RECORDED` and `VERIFIED` payments. This least-privilege Cashier access remains subject to PIC/business approval.

`POST /billing/invoices/:id/void` is a finance-role correction endpoint. It requires a reason and is tenant-scoped, serializable, and audit-backed. It returns `409 INVOICE_HAS_PAYMENTS` for any invoice with a Payment and `409 INVOICE_SETTLED` when a related Payment is allocated to ShuttleSettlement. A repeated void is a no-op `200` response with no additional audit record. `GET /shuttle/report` excludes `VOID` invoices and their payments from billed, paid, and outstanding amounts.

`PUT/GET /shuttle/financial-config`, `POST /shuttle/billing-periods/:id/settlements`, `GET /shuttle/settlements`, `POST /shuttle/settlements/:id/approve`, and `POST /shuttle/settlements/:id/mark-paid` are finance-controlled. Share amounts are calculated and snapshotted by the server; a browser never submits calculated vendor/cooperative amounts. Settlement responses consistently expose `verifiedAmount`, `vendorAmount`, and `cooperativeAmount` as safe, whole-Rupiah JSON numbers; database `Decimal` values are never used for browser-side arithmetic.

Payment proof uses `POST /attachments` with multipart fields `entityType=Payment`, `entityId`, and `file`; only PDF/JPEG/PNG/WEBP with matching content signature, MIME type, and extension up to 5 MiB are accepted. The response deliberately excludes `storageKey`, hash, filesystem path, and public URL. A proof download is only available through authenticated `GET /attachments/:id/download`; no endpoint currently lists historical Payment attachments, so the current UI only displays a proof uploaded in its active session.

There is currently no API to edit a Shuttle route, change a subscription lifecycle state, model a Guardian relation, retrieve one invoice by ID, or list Payment attachments. The web client must not imitate these capabilities locally.

## Store SKU contract

`POST /products` and `PATCH /products/:id` accept only 2–50 character ASCII SKU values matching `[A-Za-z0-9][A-Za-z0-9._/-]{1,49}` and return/store their uppercase canonical form. The tenant-scoped Product uniqueness boundary is also enforced by PostgreSQL; clients must not depend on preservation of SKU letter case.

## CP6 activity-category suggestion contract

The private FastAPI service exposes `POST /v1/activity-category/predict` for F4. It accepts only `{ "note_deidentified": string }` after de-identification and returns an enum `predicted_category` (`INVENTORY`, `SALES`, `SERVICE`, or `ADMINISTRATION`), either `confidence` **or** `decision_score`, `model_version`, `label_version`, and `inference_status: "ok"`. A decision score is not a probability. FastAPI loads only `NOVO_ACTIVITY_MODEL_DIR` (default `./models/activity_category_v02_final`) and its configured `NOVO_ACTIVITY_MODEL_VERSION` (default `activity-category-v0.2-39098d6f4f26`); it rejects an absent, mismatched, or non-final artifact without retraining or falling back to an earlier artifact. `NOVO_ML_SERVING_MODE=activity_only` is the no-retraining F4 mode: it skips legacy intent/demand loading and reports those capabilities unavailable rather than synthesizing a fallback.

Browsers must call `POST /api/v1/analytics/activity-classification`, never FastAPI directly. The cookie-authenticated Express route requires the existing CSRF and trusted-Origin controls plus `OWNER`, `ADMIN`, or `ANALYST` server permission (including the documented delegated roles). It accepts the strict request `{ "noteDeidentified": string }` with 3–500 meaningful characters; `tenantId` and unknown fields are rejected. Tenant scope is derived only from the server session.

The public response is `{ predictedCategory, modelVersion, labelVersion, inferenceStatus: "SUCCESS", confidence? | decisionScore? }`. `503 ML_SERVICE_UNAVAILABLE`, `504 ML_SERVICE_TIMEOUT`, and `502 ML_SERVICE_INVALID_RESPONSE` are fail-closed outcomes: clients must offer a manual draft choice rather than fabricate a prediction. The audit record includes only the selected label/version/status, never the raw note. This checkpoint neither persists an activity nor changes an invoice, settlement, stock movement, or any other business record; accepting/correcting a category remains browser-only draft state.

The model was final-evaluated once on a small synthetic hold-out. Its score does not establish operational accuracy or production readiness. Dataset privacy, grouped split, final-evaluation gate, and reproducibility requirements are in `docs/ACTIVITY_DATASET_CONTRACT.md`.

## Model-service contract

The backend calls the private FastAPI service, not the browser.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /v1/intent/predict` | `{text}` | `{intent, confidence, model}` |
| `POST /v1/demand/predict` | `{day_of_week, month, active_subscriptions, promotion}` | `{predicted_daily_demand, model, caveat}` |
| `POST /v1/rag/answer` | `{question, documents:[{id,title,content}]}` | `{answer, sources, intent, retrievalMode}` |
| `GET /v1/evaluations` | none | Hold-out comparisons for both trained model families |

The ML service returns `503` while models load and reports a retrieval-only fallback when configured generation is unavailable. Treat these as normal, visible availability states rather than silent success.

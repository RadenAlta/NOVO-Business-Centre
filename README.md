# NOVO Business Centre

Greenfield multi-tenant operations platform for a school cooperative and its business units:

- SO Store: catalog, stock movements, POS sales and low-stock reporting
- Shuttle: routes, subscriptions, invoices, payments and settlement records
- Catering: orders and fulfilment status
- Funding: member savings accounts and an append-only ledger
- Financing: applications, procurement records, receivable schedules and payment status
- Master data: tenants, cooperative members, users, roles, attachments and audit logs

The implementation is intentionally separate from any assessment submission. It must not be represented as entirely participant-authored capstone work. Use it transparently for learning, review, or as an independent product implementation.

## Architecture

```text
apps/web        React + Vite responsive operations UI
apps/api        Express + TypeScript REST API, Prisma and PostgreSQL
apps/dashboard  Streamlit business-data dashboard
services/ml     FastAPI model service: trained intent + demand models
packages/contracts Shared API contracts and quest traceability
```

## Quick start

1. Install Node 22+ and Python 3.11+.
2. Copy `.env.example` to `.env` and set a unique `JWT_SECRET`.
3. Start PostgreSQL: `docker compose up -d postgres`.
4. Install JavaScript packages: `pnpm install`.
5. Create schema and sample workspace: `pnpm db:migrate && pnpm --filter @novo/api seed`.
6. Start the product: `pnpm dev`.
7. In another shell, create a Python virtual environment, install `services/ml/requirements.txt`, then run `uvicorn app.main:app --app-dir services/ml --reload --port 8000`.

The seeded administrator is `owner@demo.novo.local` / `ChangeMe123!`; change it immediately in any non-local environment.

## Quality and scope status

The product deliberately uses synthetic seed/training data only. Do not upload identifiable student, parent, customer, payment-card, or health data until retention, consent, access controls, and a security review are in place.

See [docs/NOVO-PRD-COVERAGE.md](docs/NOVO-PRD-COVERAGE.md) for source-PRD coverage and explicit product gaps. See [docs/QUEST-TRACEABILITY.md](docs/QUEST-TRACEABILITY.md) for Main/Side Quest coverage and test evidence, plus [docs/SECURITY.md](docs/SECURITY.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before deploying.

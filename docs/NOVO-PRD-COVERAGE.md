# NOVO PRD coverage

This document separates implemented vertical slices from source requirements that still need product work. It is an engineering inventory, not a statement that any educational checklist is complete.

## Available now

| Area | Working source coverage | Deliberate boundary |
| --- | --- | --- |
| Identity and access | PostgreSQL schema, tenant isolation, canonical NOVO roles, bcrypt passwords, JWT authentication, browser HttpOnly cookie, audit events | Cookie is not a database-backed/revocable session; role assignment UI and password-reset flow are absent |
| Master Data | Manual create/list/update/activate for students, teachers, employees; unique typed identifiers; source/provenance fields; Master Data web screen | Excel import and SIMS synchronisation are not implemented |
| Membership | Cooperative member model may link to a master identity; a student identity is rejected; linked name/contact fields come from that identity | Membership creation form and rigorous migration of legacy unlinked records are unfinished |
| SO Store | Product catalogue, stock movements, POS checkout, low-stock dashboard | HPP/cost layers, supplier/category management, cash-closing and formal stock-opname remain |
| Shuttle | Routes, subscriptions, invoices, guarded payments, settlements | Vendor share calculation, partial-payment UX, settlement evidence workflow and operational trip attendance remain |
| Catering | Order creation and fulfilment state | Vendor, menu/package, recipient/period fee, invoice and reconciliation workflows are not yet modelled |
| Funding | Savings account and append-only credit/debit ledger | Mandatory/voluntary/other categories, restricted funds and reconciliation are not yet modelled |
| Financing | Application, receivable schedule and status records | Procurement-oriented financing/HPP workflow, approval evidence, allocations and reconciliation remain |
| Purchasing | Request workflow is explicitly labelled as an extension | It is not claimed as a formal source PRD baseline module |
| Attachments and audit | Type, binary-signature and size checks, SHA-256, filename sanitisation, tenant-scoped download and audit metadata | No malware scanner, private object storage, signed URLs or per-business-entity authorization policy |
| Reporting and integration | Operations summary and separate Streamlit analytics dashboard with synthetic-data labeling | Cross-unit reports, backup/restore, SIMS sync and a deployed environment remain |

## Privacy and data discipline

Only synthetic seed and training data are included. Do not add real student, family, employee, customer, bank, payment-card or health records without separate consent, retention, authorization and security review.

## Status vocabulary

- **Working source coverage** means a coherent code path and schema are present.
- **Boundary** means an explicit gap, simplification or verification limitation. It must not be represented as delivered functionality.
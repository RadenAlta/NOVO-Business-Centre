# Data problem definition

## Intended decision

For a cooperative operator, decide which retail products need replenishment and understand recent store revenue by date and category. The operational product also uses predicted **daily shuttle-demand proxy** only for exploratory capacity planning; it does not make automated transport, finance, eligibility, or safety decisions.

## Data roles

- Store transactions power revenue, unit, product, and category views.
- Inventory movements determine current on-hand stock and low-stock exceptions.
- Shuttle active-subscription count, weekday, month, and a promotion flag are features for the development demand model.
- Knowledge documents are retrieved for the assistant. They are not training data unless explicitly labelled and consented.

## Data safeguards

This repository generates synthetic development data. It contains no real student, parent, school, customer, or payment data. Before a production model or dashboard claim, document source ownership, consent/legal basis, retention, field-level access, de-identification, currency/time-zone conventions, and a data-quality check. Never use a model response as an approval for funding, credit, or membership.

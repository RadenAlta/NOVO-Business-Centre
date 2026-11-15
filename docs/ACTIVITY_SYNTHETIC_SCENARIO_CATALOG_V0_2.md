# Katalog Skenario Sintetis Aktivitas F4 v0 2

Setiap family memiliki tiga formulasi yang sepadan dan semuanya sintetis. `A` berarti `AMBIGUOUS_REVIEWED`; selain itu statusnya `CLEAR`. Split berlaku per keluarga, bukan per baris.

## Inventory

| Split | Family | Unit | Primary action | Review |
| --- | --- | --- | --- | --- |
| Train | inv-store-receipt | Store | stock receipt | CLEAR |
| Train | inv-stock-opname | Store | stock count | CLEAR |
| Train | inv-catering-ingredient | Catering | ingredient control | CLEAR |
| Train | inv-damaged-goods | Store | damage quarantine | CLEAR |
| Train | inv-shuttle-supplies | Shuttle | operational supplies | CLEAR |
| Train | inv-reorder-threshold | Store | reorder decision | CLEAR |
| Validation | inv-cold-storage | Catering | storage location | CLEAR |
| Validation | inv-supplier-shortfall | Store | supplier follow-up | A |
| Validation | inv-internal-transfer | Operations | inventory transfer | A |
| Frozen test | inv-frozen-expiry | Store | expiry review | CLEAR |
| Frozen test | inv-frozen-portion | Catering | portion stock | CLEAR |
| Frozen test | inv-frozen-return-to-stock | Store | return to stock | CLEAR |

## Sales

| Split | Family | Unit | Primary action | Review |
| --- | --- | --- | --- | --- |
| Train | sales-pos-price | Store | price correction | CLEAR |
| Train | sales-cash-reconciliation | Store | cash reconciliation | CLEAR |
| Train | sales-qris-reconciliation | Store | payment reconciliation | CLEAR |
| Train | sales-catering-order | Catering | order sale | CLEAR |
| Train | sales-shuttle-fee | Shuttle | service fee collection | A |
| Train | sales-return-refund | Store | sale reversal | CLEAR |
| Validation | sales-queue | Store | checkout service | CLEAR |
| Validation | sales-invoice-match | Catering | invoice sales match | A |
| Validation | sales-discount-approval | Store | discount application | CLEAR |
| Frozen test | sales-frozen-closeout | Store | daily closeout | CLEAR |
| Frozen test | sales-frozen-cancellation | Catering | order cancellation | CLEAR |
| Frozen test | sales-frozen-receipt | Store | receipt lookup | CLEAR |

## Service

| Split | Family | Unit | Primary action | Review |
| --- | --- | --- | --- | --- |
| Train | service-route-change | Shuttle | route communication | CLEAR |
| Train | service-pickup-delay | Shuttle | pickup recovery | CLEAR |
| Train | service-delivery-confirmation | Catering | delivery confirmation | CLEAR |
| Train | service-menu-feedback | Catering | feedback follow-up | CLEAR |
| Train | service-driver-briefing | Shuttle | service readiness | CLEAR |
| Train | service-store-assistance | Store | customer assistance | CLEAR |
| Validation | service-special-handling | Catering | service exception | A |
| Validation | service-incident-followup | Shuttle | incident follow-up | CLEAR |
| Validation | service-frozen-queue | Operations | service queue management | CLEAR |
| Frozen test | service-frozen-quality | Catering | service quality check | CLEAR |
| Frozen test | service-frozen-notification | Shuttle | service notification | CLEAR |
| Frozen test | service-frozen-accessibility | Store | accessibility support | CLEAR |

## Administration

| Split | Family | Unit | Primary action | Review |
| --- | --- | --- | --- | --- |
| Train | admin-membership-update | Operations | membership record | CLEAR |
| Train | admin-billing-period | Shuttle | billing administration | CLEAR |
| Train | admin-ledger-reference | Funding | ledger reference | CLEAR |
| Train | admin-procurement-file | Financing | document completeness | CLEAR |
| Train | admin-audit-log | Operations | audit review | CLEAR |
| Train | admin-vendor-file | Catering | vendor documentation | CLEAR |
| Validation | admin-price-approval | Store | approval record | A |
| Validation | admin-form-correction | Operations | form correction | CLEAR |
| Validation | admin-settlement-document | Shuttle | settlement documentation | A |
| Frozen test | admin-frozen-retention | Operations | retention review | CLEAR |
| Frozen test | admin-frozen-report | Funding | report preparation | CLEAR |
| Frozen test | admin-frozen-access | Operations | access review | CLEAR |

Katalog mencatat variasi unit, tujuan, kondisi normal/pengecualian, urutan informasi, gaya bahasa, dan multi-topik. Ia bukan bukti bahwa variasi tersebut cukup untuk penggunaan produksi; PIC perlu menyetujui seluruh family ambigu sebelum training v0.2.

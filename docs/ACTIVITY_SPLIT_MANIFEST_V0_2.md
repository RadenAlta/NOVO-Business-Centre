# Manifest Split Aktivitas F4 v0 2

Manifest ini dibekukan sebelum eksperimen model berikutnya. Seed: `20261105`. Dataset hash: `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47`. Dataset: `activity-dataset-v0.2`; taxonomy: `activity-category-v0.1`; total 144 record dan 48 keluarga skenario.

| Split | Keluarga per label | Record per label | Total record |
| --- | ---: | ---: | ---: |
| TRAIN | 6 | 18 | 72 |
| VALIDATION | 3 | 9 | 36 |
| TEST final hold-out | 3 | 9 | 36 |

Final hold-out yang tidak boleh dipakai untuk tuning: `inv-frozen-expiry`, `inv-frozen-portion`, `inv-frozen-return-to-stock`; `sales-frozen-cancellation`, `sales-frozen-closeout`, `sales-frozen-receipt`; `service-frozen-accessibility`, `service-frozen-notification`, `service-frozen-quality`; `admin-frozen-access`, `admin-frozen-report`, `admin-frozen-retention`.

Keluarga validation: `inv-cold-storage`, `inv-internal-transfer`, `inv-supplier-shortfall`; `sales-discount-approval`, `sales-invoice-match`, `sales-queue`; `service-frozen-queue`, `service-incident-followup`, `service-special-handling`; `admin-form-correction`, `admin-price-approval`, `admin-settlement-document`.

Keluarga lain dalam katalog adalah train. Manifest harus diperbarui secara versioned jika dan hanya jika dataset baru disetujui sebelum eksperimen baru; ia tidak boleh diedit untuk meningkatkan hasil final hold-out.

# Dashboard data dictionary

| Field | Type | Definition |
| --- | --- | --- |
| `occurred_at` | datetime | Waktu transaksi terjadi, used for date filtering. |
| `product_name` | string | Nama produk seperti dicatat pada transaksi. |
| `category` | string | Kategori produk untuk breakdown dashboard. |
| `quantity` | integer | Jumlah unit pada baris transaksi. Must be non-negative. |
| `total` | decimal IDR | Nilai total baris transaksi. Must be non-negative. |

The Streamlit dashboard accepts a CSV using exactly these required fields. Synthetic records are clearly labelled and serve only as a development/demo dataset. They must not be reported as school or customer observations.

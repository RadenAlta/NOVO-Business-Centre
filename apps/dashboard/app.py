from __future__ import annotations

from io import BytesIO

import numpy as np
import pandas as pd
import streamlit as st

st.set_page_config(page_title="NOVO Business Dashboard", page_icon="N", layout="wide")

REQUIRED_COLUMNS = {"occurred_at", "product_name", "category", "quantity", "total"}

@st.cache_data
def synthetic_transactions() -> pd.DataFrame:
    """Explicitly synthetic records for local development and UI validation."""
    rng = np.random.default_rng(42)
    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=90, freq="D")
    rows = []
    products = [("Snack Box Demo", "Makanan", 15000), ("Air Mineral", "Minuman", 5000), ("Buku Tulis", "ATK", 7000)]
    for day in dates:
        for product, category, price in products:
            for _ in range(int(rng.integers(0, 6))):
                quantity = int(rng.integers(1, 5))
                rows.append({"occurred_at": day + pd.Timedelta(hours=int(rng.integers(7, 17))), "product_name": product, "category": category, "quantity": quantity, "total": quantity * price})
    return pd.DataFrame(rows)

def load_csv(uploaded: BytesIO) -> pd.DataFrame:
    data = pd.read_csv(uploaded)
    missing = REQUIRED_COLUMNS - set(data.columns)
    if missing:
        raise ValueError(f"Kolom wajib tidak ada: {', '.join(sorted(missing))}")
    result = data.copy()
    result["occurred_at"] = pd.to_datetime(result["occurred_at"], errors="coerce")
    result["quantity"] = pd.to_numeric(result["quantity"], errors="coerce")
    result["total"] = pd.to_numeric(result["total"], errors="coerce")
    result = result.dropna(subset=["occurred_at", "product_name", "category", "quantity", "total"])
    if (result["quantity"] < 0).any() or (result["total"] < 0).any():
        raise ValueError("quantity dan total harus bernilai nol atau positif.")
    return result

st.title("Dashboard operasi NOVO")
st.caption("Untuk pemantauan transaksi toko. Data yang ditampilkan mengikuti sumber yang dipilih, bukan data sekolah nyata.")

with st.sidebar:
    st.header("Sumber data")
    source = st.radio("Pilih sumber", ["Demo sintetis", "Unggah CSV"], label_visibility="collapsed")
    uploaded = st.file_uploader("CSV transaksi", type="csv", help="Kolom: occurred_at, product_name, category, quantity, total") if source == "Unggah CSV" else None
    st.divider()
    st.caption("Definisi: revenue = jumlah total transaksi setelah filter. Average basket = revenue dibagi jumlah baris transaksi, bukan jumlah pelanggan unik.")

if source == "Demo sintetis":
    records = synthetic_transactions()
    st.info("Mode demo sintetis aktif. Jangan gunakan angka ini untuk keputusan bisnis nyata.")
elif uploaded is None:
    st.warning("Unggah CSV untuk mulai menganalisis data operasional.")
    st.stop()
else:
    try:
        records = load_csv(uploaded)
    except ValueError as error:
        st.error(str(error))
        st.stop()

if records.empty:
    st.warning("Sumber data tidak memiliki baris transaksi yang dapat dianalisis.")
    st.stop()

min_date, max_date = records["occurred_at"].dt.date.min(), records["occurred_at"].dt.date.max()
left, right = st.columns([1, 1])
with left:
    selected_dates = st.date_input("Rentang tanggal", value=(min_date, max_date), min_value=min_date, max_value=max_date)
with right:
    categories = sorted(records["category"].dropna().unique().tolist())
    selected_categories = st.multiselect("Kategori", categories, default=categories)

if isinstance(selected_dates, tuple) and len(selected_dates) == 2:
    start_date, end_date = selected_dates
else:
    start_date = end_date = selected_dates
filtered = records[(records["occurred_at"].dt.date >= start_date) & (records["occurred_at"].dt.date <= end_date) & (records["category"].isin(selected_categories))].copy()

if filtered.empty:
    st.warning("Tidak ada transaksi pada filter tersebut. Ubah rentang tanggal atau kategori.")
    st.stop()

revenue = float(filtered["total"].sum())
transactions = int(len(filtered))
quantity = int(filtered["quantity"].sum())
avg_basket = revenue / transactions if transactions else 0
m1, m2, m3, m4 = st.columns(4)
m1.metric("Revenue", f"Rp{revenue:,.0f}".replace(",", "."))
m2.metric("Baris transaksi", f"{transactions:,}".replace(",", "."))
m3.metric("Unit terjual", f"{quantity:,}".replace(",", "."))
m4.metric("Rata-rata basket", f"Rp{avg_basket:,.0f}".replace(",", "."))

st.subheader("Trend revenue harian")
daily = filtered.assign(date=filtered["occurred_at"].dt.date).groupby("date", as_index=False)["total"].sum().set_index("date")
st.line_chart(daily, y="total", use_container_width=True)

chart_col, table_col = st.columns([1.1, .9])
with chart_col:
    st.subheader("Revenue menurut kategori")
    by_category = filtered.groupby("category", as_index=False)["total"].sum().sort_values("total", ascending=False).set_index("category")
    st.bar_chart(by_category, y="total", use_container_width=True)
with table_col:
    st.subheader("Produk dengan revenue tertinggi")
    by_product = filtered.groupby(["product_name", "category"], as_index=False).agg(revenue=("total", "sum"), units=("quantity", "sum")).sort_values("revenue", ascending=False).head(10)
    st.dataframe(by_product, use_container_width=True, hide_index=True, column_config={"revenue": st.column_config.NumberColumn("Revenue", format="Rp %d"), "units": st.column_config.NumberColumn("Unit")})

with st.expander("Data setelah filter"):
    st.dataframe(filtered.sort_values("occurred_at", ascending=False), use_container_width=True, hide_index=True)
    st.download_button("Unduh data terfilter", filtered.to_csv(index=False).encode("utf-8"), file_name="novo-transaksi-terfilter.csv", mime="text/csv")

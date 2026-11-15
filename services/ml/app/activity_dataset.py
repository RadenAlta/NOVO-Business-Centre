"""Synthetic, privacy-safe activity-note dataset for the F4 demonstrator.

This module deliberately keeps the activity-classification corpus separate from
the customer-question intent corpus in :mod:`app.training`. An activity note
answers "what operational follow-up category is suggested?"; it is not a
customer-service intent and must not be used to automate financial actions.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import re
from typing import Any, Iterable, Mapping, Sequence


# The taxonomy is deliberately unchanged from v0.1. Dataset v0.2 increases
# scenario diversity; it does not silently relabel historic training records.
DATASET_VERSION = "activity-dataset-v0.2"
LABEL_VERSION = "activity-category-v0.1"
SOURCE_TYPES = frozenset({"SYNTHETIC", "CONSENTED_DEIDENTIFIED"})
BUSINESS_UNITS = frozenset({"STORE", "SHUTTLE", "CATERING", "FUNDING", "FINANCING", "OPERATIONS"})
ACTIVITY_CATEGORIES = ("INVENTORY", "SALES", "SERVICE", "ADMINISTRATION")
SPLITS = ("TRAIN", "VALIDATION", "TEST")
REVIEW_STATUSES = frozenset({"CLEAR", "AMBIGUOUS_REVIEWED"})
REQUIRED_FIELDS = (
    "activity_id", "occurred_at", "business_unit", "note_deidentified",
    "category_label", "source_type", "label_version", "provenance", "split",
)


class ActivityDatasetError(ValueError):
    """The activity dataset violates a declared contract or leakage guard."""


def normalize_note(value: str) -> str:
    return " ".join(value.lower().split())


def _require_text(record: Mapping[str, Any], field: str, minimum: int = 1, maximum: int = 500) -> str:
    value = record.get(field)
    if not isinstance(value, str):
        raise ActivityDatasetError(f"{field} must be a string")
    normalized = " ".join(value.split())
    if not minimum <= len(normalized) <= maximum:
        raise ActivityDatasetError(f"{field} must be between {minimum} and {maximum} characters")
    return normalized


def validate_activity_records(records: Sequence[Mapping[str, Any]]) -> list[dict[str, str]]:
    """Validate records without accepting missing, personal, or ambiguous fields."""
    if not records:
        raise ActivityDatasetError("activity dataset must contain at least one record")
    validated: list[dict[str, str]] = []
    for index, raw in enumerate(records):
        missing = [field for field in REQUIRED_FIELDS if field not in raw]
        if missing:
            raise ActivityDatasetError(f"record {index} is missing required fields: {', '.join(missing)}")
        activity_id = _require_text(raw, "activity_id", 8, 120)
        if not re.fullmatch(r"[A-Za-z0-9._:-]+", activity_id):
            raise ActivityDatasetError("activity_id contains unsupported characters")
        occurred_at = _require_text(raw, "occurred_at", 20, 40)
        try:
            datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ActivityDatasetError("occurred_at must be an ISO-8601 timestamp") from error
        business_unit = _require_text(raw, "business_unit", 2, 32).upper()
        if business_unit not in BUSINESS_UNITS:
            raise ActivityDatasetError("business_unit is not allowed by the activity contract")
        note = _require_text(raw, "note_deidentified", 12, 500)
        if "@" in note or re.search(r"\+?\d[\d\s-]{7,}\d", note):
            raise ActivityDatasetError("note_deidentified appears to contain contact data")
        category = _require_text(raw, "category_label", 2, 64).upper()
        if category not in ACTIVITY_CATEGORIES:
            raise ActivityDatasetError("category_label is not allowed by the activity contract")
        source_type = _require_text(raw, "source_type", 2, 64).upper()
        if source_type not in SOURCE_TYPES:
            raise ActivityDatasetError("source_type is not allowed by the activity contract")
        label_version = _require_text(raw, "label_version", 3, 64)
        if label_version != LABEL_VERSION:
            raise ActivityDatasetError("label_version is not supported by this training pipeline")
        provenance = _require_text(raw, "provenance", 12, 300)
        split = _require_text(raw, "split", 2, 32).upper()
        if split not in SPLITS:
            raise ActivityDatasetError("split must be TRAIN, VALIDATION, or TEST")
        record = {"activity_id": activity_id, "occurred_at": occurred_at, "business_unit": business_unit,
                  "note_deidentified": note, "category_label": category, "source_type": source_type,
                  "label_version": label_version, "provenance": provenance, "split": split}
        for field, minimum, maximum in (("template_family", 3, 120), ("semantic_group", 3, 120), ("primary_action", 3, 120)):
            if field in raw:
                record[field] = _require_text(raw, field, minimum, maximum)
        if "review_status" in raw:
            review_status = _require_text(raw, "review_status", 3, 64).upper()
            if review_status not in REVIEW_STATUSES:
                raise ActivityDatasetError("review_status is not allowed by the activity contract")
            record["review_status"] = review_status
        validated.append(record)
    return validated


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", normalize_note(value)))


def assert_leakage_safe(records: Sequence[Mapping[str, Any]]) -> None:
    """Reject duplicates and declared semantic groups crossing split boundaries."""
    validated = validate_activity_records(records)
    seen_ids: set[str] = set()
    note_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    group_splits: dict[str, set[str]] = defaultdict(set)
    for record in validated:
        if record["activity_id"] in seen_ids:
            raise ActivityDatasetError("activity_id values must be unique")
        seen_ids.add(record["activity_id"])
        note_rows[normalize_note(record["note_deidentified"])].append(record)
        for group_field in ("template_family", "semantic_group"):
            group = record.get(group_field)
            if group:
                group_splits[f"{group_field}:{group}"].add(record["split"])
    if any(len(rows) > 1 for rows in note_rows.values()):
        raise ActivityDatasetError("duplicate note text is not permitted in the activity dataset")
    if any(len(splits) > 1 for splits in group_splits.values()):
        raise ActivityDatasetError("template_family or semantic_group crosses a train/validation/test boundary")
    # This deterministic lexical guard does not claim semantic understanding. It
    # catches obvious paraphrase/template leakage; semantic review remains a
    # documented human gate before a corpus is frozen.
    for index, left in enumerate(validated):
        left_tokens = _tokens(left["note_deidentified"])
        for right in validated[index + 1 :]:
            if left["split"] == right["split"]:
                continue
            right_tokens = _tokens(right["note_deidentified"])
            overlap = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
            if overlap >= 0.80:
                raise ActivityDatasetError("near-duplicate note text crosses a train/validation/test boundary")


def dataset_sha256(records: Sequence[Mapping[str, Any]]) -> str:
    canonical = json.dumps(validate_activity_records(records), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def class_distribution(records: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    return dict(sorted(Counter(str(record["category_label"]) for record in records).items()))


def dataset_quality_report(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Return deterministic review signals; it is not a semantic similarity model."""
    validated = validate_activity_records(records)
    assert_leakage_safe(validated)
    family_counts: dict[str, int] = Counter(record.get("template_family", "") for record in validated)
    by_label_split = {split: class_distribution(record for record in validated if record["split"] == split) for split in SPLITS}
    token_labels: dict[str, set[str]] = defaultdict(set)
    token_count: Counter[str] = Counter()
    for record in validated:
        for token in _tokens(record["note_deidentified"]):
            token_labels[token].add(record["category_label"])
            token_count[token] += 1
    boilerplate = sorted(token for token, labels in token_labels.items() if len(labels) >= 3 and token_count[token] >= 8)
    label_shortcuts = {label: sorted(token for token, labels in token_labels.items() if labels == {label} and token_count[token] >= 3) for label in ACTIVITY_CATEGORIES}
    return {"dataset_version": DATASET_VERSION, "record_count": len(validated), "class_distribution": by_label_split,
            "template_family_count": len({family for family in family_counts if family}),
            "ambiguous_reviewed_count": sum(record.get("review_status") == "AMBIGUOUS_REVIEWED" for record in validated),
            "boilerplate_tokens_for_human_review": boilerplate,
            "label_specific_tokens_for_human_review": label_shortcuts}


# Each family is a distinct operational scenario. The three notes within one
# family are deliberate paraphrases and always remain in the same split.
# Positions 0–5 train, 6–8 validation, and 9–11 are the frozen final hold-out
# for each label. No final-hold-out note may guide future model selection.
_SCENARIOS: tuple[tuple[str, str, str, str, str, tuple[str, str, str]], ...] = (
    ("INVENTORY", "STORE", "inv-store-receipt", "stock_receipt", "CLEAR", ("Petugas toko menerima kiriman alat tulis dan mencocokkan jumlah kotak dengan surat jalan.", "Jumlah minuman kemasan dari pemasok dihitung sebelum stok toko ditambahkan.", "Barang titipan untuk rak koperasi diperiksa kuantitas serta kondisi kemasannya saat tiba.")),
    ("INVENTORY", "STORE", "inv-stock-opname", "stock_count", "CLEAR", ("Stok beras di gudang berbeda dari hitungan rak sehingga perlu stock opname.", "Petugas menemukan selisih antara kartu stok dan jumlah sabun yang tersedia.", "Penghitungan fisik barang toko dilakukan ulang karena catatan persediaan tidak seimbang.")),
    ("INVENTORY", "CATERING", "inv-catering-ingredient", "ingredient_control", "CLEAR", ("Bahan baku katering untuk menu besok dipisahkan karena sebagian mendekati batas mutu.", "Dapur mencatat kekurangan minyak goreng sebelum produksi paket makan dimulai.", "Persediaan bahan katering diperiksa untuk memastikan pesanan harian dapat dipenuhi.")),
    ("INVENTORY", "STORE", "inv-damaged-goods", "damage_quarantine", "CLEAR", ("Beberapa kemasan makanan rusak dan dipindahkan dari rak penjualan untuk pemeriksaan.", "Produk bocor ditemukan saat toko buka sehingga stok layak jual perlu dikoreksi.", "Barang dengan label pudar dipisahkan agar tidak ikut dihitung sebagai persediaan siap jual.")),
    ("INVENTORY", "SHUTTLE", "inv-shuttle-supplies", "operational_supplies", "CLEAR", ("Persediaan kartu identitas perjalanan diperiksa sebelum layanan shuttle pagi dimulai.", "Perlengkapan keselamatan kendaraan perlu dicatat ulang setelah satu paket digunakan.", "Gudang operasional menyiapkan persediaan konsumsi pengemudi untuk rute tambahan.")),
    ("INVENTORY", "STORE", "inv-reorder-threshold", "reorder_decision", "CLEAR", ("Stok buku tulis mencapai batas minimum dan daftar pemesanan ulang perlu disiapkan.", "Sistem persediaan menunjukkan barang populer hampir habis sebelum jam ramai.", "Petugas membuat usulan pembelian ulang karena sisa produk berada di bawah ambang stok.")),
    ("INVENTORY", "CATERING", "inv-cold-storage", "storage_location", "CLEAR", ("Bahan segar dipindahkan ke penyimpanan dingin dan lokasi stok harus diperbarui.", "Dapur mengubah lokasi beras cadangan agar pemeriksaan persediaan berikutnya akurat.", "Rak bahan kering ditata ulang sehingga catatan lokasi barang perlu disesuaikan.")),
    ("INVENTORY", "STORE", "inv-supplier-shortfall", "supplier_followup", "AMBIGUOUS_REVIEWED", ("Kiriman pemasok kurang dua dus; prioritas catatan adalah menindaklanjuti penerimaan stok, bukan pembayaran.", "Toko menerima barang tidak lengkap dan petugas perlu mencatat selisih persediaan sebelum menghubungi pemasok.", "Daftar penerimaan menunjukkan item belum datang; label dipilih INVENTORY karena tindakan utama adalah verifikasi stok.")),
    ("INVENTORY", "OPERATIONS", "inv-internal-transfer", "inventory_transfer", "AMBIGUOUS_REVIEWED", ("Barang dipindahkan dari gudang ke unit katering; catatan utama adalah perpindahan persediaan antar lokasi.", "Unit toko menyerahkan gelas kemasan ke dapur dan saldo stok kedua unit perlu diperbarui.", "Pemindahan bahan antar gudang membutuhkan pencatatan kuantitas sebelum aktivitas layanan dilanjutkan.")),
    ("INVENTORY", "STORE", "inv-frozen-expiry", "expiry_review", "CLEAR", ("Produk dengan tanggal kedaluwarsa dekat ditandai untuk rotasi rak dan penghitungan stok.", "Petugas mengulas persediaan yang tidak boleh dijual setelah minggu ini.", "Daftar barang mendekati kedaluwarsa diperiksa untuk menentukan penempatan persediaan.")),
    ("INVENTORY", "CATERING", "inv-frozen-portion", "portion_stock", "CLEAR", ("Dapur menghitung porsi bahan yang tersisa setelah pesanan katering selesai disiapkan.", "Sisa bahan menu siang dicatat agar kebutuhan produksi esok hari dapat direncanakan.", "Kuantitas bahan per porsi diverifikasi sebelum dapur menerima pesanan tambahan.")),
    ("INVENTORY", "STORE", "inv-frozen-return-to-stock", "return_to_stock", "CLEAR", ("Barang yang dikembalikan pelanggan diperiksa kelayakannya sebelum dimasukkan kembali ke stok.", "Petugas menilai kondisi produk retur agar saldo persediaan tidak bertambah keliru.", "Produk pengganti yang tidak jadi diambil ditata kembali setelah jumlah fisiknya diverifikasi.")),
    ("SALES", "STORE", "sales-pos-price", "price_correction", "CLEAR", ("Harga pada label rak berbeda dari harga kasir sehingga transaksi perlu dikoreksi.", "Kasir melaporkan harga diskon belum muncul pada pemindaian barang.", "Pelanggan menerima total yang tidak sesuai promosi dan catatan penjualan perlu diperiksa.")),
    ("SALES", "STORE", "sales-cash-reconciliation", "cash_reconciliation", "CLEAR", ("Uang tunai kasir dibandingkan dengan rekap transaksi penjualan akhir hari.", "Laporan POS menunjukkan selisih kecil yang perlu dicocokkan dengan penerimaan kas.", "Petugas menelusuri transaksi penjualan karena nilai kas fisik belum sama dengan rekap.")),
    ("SALES", "STORE", "sales-qris-reconciliation", "payment_reconciliation", "CLEAR", ("Pembayaran QRIS dicocokkan dengan transaksi toko yang tercatat pada jam istirahat.", "Rekap metode pembayaran menunjukkan satu transaksi digital belum terkonfirmasi.", "Kasir memeriksa bukti pembayaran non-tunai agar penjualan harian terekap benar.")),
    ("SALES", "CATERING", "sales-catering-order", "order_sale", "CLEAR", ("Pesanan katering bertambah setelah konfirmasi sehingga nilai penjualan perlu diperbarui.", "Unit katering mencatat perubahan jumlah paket sebelum tagihan pesanan dibuat.", "Permintaan tambahan menu dicatat sebagai perubahan transaksi penjualan katering.")),
    ("SALES", "SHUTTLE", "sales-shuttle-fee", "service_fee_collection", "AMBIGUOUS_REVIEWED", ("Pembayaran layanan shuttle tercatat sebagian; label SALES dipilih karena tindakan utama adalah pencatatan penerimaan layanan.", "Petugas merekonsiliasi biaya perjalanan yang dibayar melalui kanal transfer.", "Tagihan layanan antar jemput memerlukan pencatatan pembayaran sebelum status penjualan diperbarui.")),
    ("SALES", "STORE", "sales-return-refund", "sale_reversal", "CLEAR", ("Barang tercatat dua kali pada struk dan kasir perlu memproses koreksi transaksi.", "Pelanggan membatalkan satu item setelah pembayaran sehingga riwayat penjualan ditinjau.", "Petugas mengonfirmasi retur toko agar nilai penjualan tidak tetap tercatat ganda.")),
    ("SALES", "STORE", "sales-queue", "checkout_service", "CLEAR", ("Antrean kasir meningkat saat istirahat dan penutupan transaksi perlu dipantau.", "Toko membuka jalur pembayaran tambahan karena banyak pembeli menunggu.", "Petugas memeriksa proses checkout untuk mengurangi penundaan transaksi penjualan.")),
    ("SALES", "CATERING", "sales-invoice-match", "invoice_sales_match", "AMBIGUOUS_REVIEWED", ("Nilai pesanan katering dibandingkan dengan invoice; label SALES karena fokusnya adalah nilai transaksi yang dijual.", "Rekap paket makan perlu dicocokkan dengan total tagihan pelanggan sintetis.", "Unit katering meninjau selisih jumlah pesanan dan nominal penjualan sebelum faktur diselesaikan.")),
    ("SALES", "STORE", "sales-discount-approval", "discount_application", "CLEAR", ("Diskon program koperasi diterapkan pada transaksi dan kasir memeriksa total sesudah potongan.", "Penjualan promosi membutuhkan verifikasi bahwa harga akhir sudah benar.", "Petugas meninjau penggunaan kupon agar pendapatan toko tercatat sesuai transaksi.")),
    ("SALES", "STORE", "sales-frozen-closeout", "daily_closeout", "CLEAR", ("Penutupan toko memeriksa jumlah transaksi, metode pembayaran, dan total penerimaan hari itu.", "Kasir menyelesaikan rekap jual beli sebelum pergantian shift.", "Ringkasan penjualan harian ditelaah untuk memastikan semua transaksi telah masuk laporan.")),
    ("SALES", "CATERING", "sales-frozen-cancellation", "order_cancellation", "CLEAR", ("Pesanan katering dibatalkan sebelum produksi dan nilai jualnya perlu dibalik secara tercatat.", "Unit katering mengecek pembatalan menu agar total transaksi tidak dihitung dua kali.", "Catatan penjualan diperbarui setelah pesanan makan sintetis tidak jadi diproses.")),
    ("SALES", "STORE", "sales-frozen-receipt", "receipt_lookup", "CLEAR", ("Pelanggan meminta salinan struk dan petugas menelusuri transaksi toko yang sesuai.", "Riwayat penjualan digunakan untuk mencetak kembali bukti transaksi yang hilang.", "Kasir mencari nomor penerimaan untuk menjawab permintaan bukti pembelian.")),
    ("SERVICE", "SHUTTLE", "service-route-change", "route_communication", "CLEAR", ("Urutan pemberhentian shuttle berubah dan penumpang perlu menerima pemberitahuan layanan.", "Tim operasional menyesuaikan rute antar jemput karena akses jalan sementara berubah.", "Perubahan titik layanan shuttle dicatat agar jadwal komunikasi dapat diperbarui.")),
    ("SERVICE", "SHUTTLE", "service-pickup-delay", "pickup_recovery", "CLEAR", ("Kendaraan terlambat tiba di titik jemput dan petugas perlu mengoordinasikan pemulihan layanan.", "Waktu kedatangan shuttle tidak sesuai jadwal sehingga informasi layanan harus diperbarui.", "Operator meninjau keterlambatan rute untuk mengurangi dampak kepada pengguna.")),
    ("SERVICE", "CATERING", "service-delivery-confirmation", "delivery_confirmation", "CLEAR", ("Distribusi paket makan memerlukan konfirmasi penerimaan sebelum layanan dinyatakan selesai.", "Petugas katering memeriksa apakah seluruh pesanan sudah sampai pada titik pengantaran.", "Catatan layanan mencantumkan paket yang belum diterima dan perlu tindak lanjut distribusi.")),
    ("SERVICE", "CATERING", "service-menu-feedback", "feedback_followup", "CLEAR", ("Masukan mengenai rasa menu diteruskan kepada tim katering untuk tindak lanjut layanan.", "Keluhan kualitas penyajian dicatat agar proses pelayanan dapat diperbaiki.", "Unit katering meninjau umpan balik pelanggan sintetis setelah jadwal makan selesai.")),
    ("SERVICE", "SHUTTLE", "service-driver-briefing", "service_readiness", "CLEAR", ("Pengemudi mendapat pembaruan prosedur sebelum rute pagi dimulai.", "Tim layanan menyampaikan informasi keselamatan untuk perjalanan antar jemput berikutnya.", "Kesiapan petugas shuttle diperiksa sebelum kendaraan melayani jadwal reguler.")),
    ("SERVICE", "STORE", "service-store-assistance", "customer_assistance", "CLEAR", ("Petugas toko membantu pembeli menemukan produk dan mencatat kebutuhan layanan di rak.", "Permintaan bantuan di area toko ditindaklanjuti tanpa mengubah transaksi penjualan.", "Tim layanan toko mengatur pendampingan bagi pembeli yang kesulitan memilih barang.")),
    ("SERVICE", "CATERING", "service-special-handling", "service_exception", "AMBIGUOUS_REVIEWED", ("Permintaan penanganan paket khusus dicatat sebagai SERVICE karena tindakan utama adalah pemenuhan layanan, bukan penjualan.", "Dapur menyesuaikan penyajian pesanan dengan catatan layanan yang telah disetujui.", "Koordinasi pengantaran khusus dilakukan agar kebutuhan layanan terpenuhi tepat waktu.")),
    ("SERVICE", "SHUTTLE", "service-incident-followup", "incident_followup", "CLEAR", ("Laporan ketidaknyamanan perjalanan ditinjau untuk menentukan tindak lanjut layanan shuttle.", "Operator mencatat insiden ringan pada rute dan menghubungi petugas terkait.", "Keluhan mengenai informasi jadwal memerlukan respons dari tim layanan antar jemput.")),
    ("SERVICE", "OPERATIONS", "service-frozen-queue", "service_queue_management", "CLEAR", ("Antrean layanan meningkat dan petugas mengatur urutan bantuan agar pengguna tidak menunggu lama.", "Unit operasional membagi tugas pelayanan pada periode ramai.", "Catatan layanan menyoroti waktu tunggu yang perlu diperbaiki pada shift berikutnya.")),
    ("SERVICE", "CATERING", "service-frozen-quality", "service_quality_check", "CLEAR", ("Kondisi penyajian makanan diperiksa sebelum paket meninggalkan dapur.", "Tim katering memverifikasi mutu layanan pada jadwal pengiriman hari ini.", "Pemeriksaan layanan dilakukan untuk memastikan paket siap diberikan sesuai standar.")),
    ("SERVICE", "SHUTTLE", "service-frozen-notification", "service_notification", "CLEAR", ("Pemberitahuan perubahan jam keberangkatan perlu dikirim sebelum jadwal shuttle dimulai.", "Operator menyiapkan informasi layanan untuk pengguna rute sore.", "Pesan pembaruan jadwal dibuat agar pengguna mengetahui perubahan operasional.")),
    ("SERVICE", "STORE", "service-frozen-accessibility", "accessibility_support", "CLEAR", ("Petugas menyiapkan bantuan layanan bagi pengunjung yang membutuhkan akses ke area toko.", "Unit layanan meninjau jalur bantuan agar pengguna dapat memperoleh dukungan dengan aman.", "Catatan aksesibilitas diteruskan kepada petugas untuk memperbaiki pengalaman layanan berikutnya.")),
    ("ADMINISTRATION", "OPERATIONS", "admin-membership-update", "membership_record", "CLEAR", ("Perubahan status keanggotaan diperiksa bersama dokumen pendukung sebelum dicatat.", "Administrasi koperasi memverifikasi kelengkapan data anggota sintetis.", "Petugas meninjau pembaruan berkas keanggotaan sesuai prosedur administrasi.")),
    ("ADMINISTRATION", "SHUTTLE", "admin-billing-period", "billing_administration", "CLEAR", ("Periode tagihan shuttle disiapkan dan dokumen administratifnya perlu diverifikasi.", "Petugas memeriksa kalender penagihan sebelum invoice layanan dibuat.", "Administrasi memastikan periode layanan tercatat benar untuk proses tagihan.")),
    ("ADMINISTRATION", "FUNDING", "admin-ledger-reference", "ledger_reference", "CLEAR", ("Referensi catatan simpanan diperiksa sebelum buku besar administratif dikunci.", "Petugas menelusuri dokumen pendukung untuk koreksi pencatatan dana.", "Berkas referensi transaksi sintetis dinilai kelengkapannya oleh administrasi.")),
    ("ADMINISTRATION", "FINANCING", "admin-procurement-file", "document_completeness", "CLEAR", ("Berkas pengajuan pembiayaan belum lengkap dan perlu dilengkapi sebelum penilaian lanjut.", "Administrasi menandai dokumen pendukung yang belum tersedia pada berkas pengadaan.", "Daftar persyaratan pengajuan ditelaah agar proses administrasi dapat diteruskan.")),
    ("ADMINISTRATION", "OPERATIONS", "admin-audit-log", "audit_review", "CLEAR", ("Riwayat perubahan diperiksa karena terdapat koreksi pada catatan operasional.", "Petugas administrasi menelusuri audit trail untuk memahami perubahan data.", "Dokumen pengawasan internal ditinjau sebelum catatan dikonfirmasi.")),
    ("ADMINISTRATION", "CATERING", "admin-vendor-file", "vendor_documentation", "CLEAR", ("Dokumen kerja sama pemasok katering diperiksa masa berlakunya oleh administrasi.", "Berkas vendor disusun sebelum unit katering melanjutkan proses administratif.", "Petugas memastikan lampiran perjanjian tersedia pada arsip unit usaha.")),
    ("ADMINISTRATION", "STORE", "admin-price-approval", "approval_record", "AMBIGUOUS_REVIEWED", ("Usulan harga toko menunggu persetujuan; label ADMINISTRATION karena tindakan utamanya adalah pencatatan persetujuan, bukan penjualan.", "Dokumen otorisasi perubahan harga diverifikasi sebelum disimpan dalam arsip.", "Petugas menelusuri status persetujuan untuk pembaruan kebijakan harga.")),
    ("ADMINISTRATION", "OPERATIONS", "admin-form-correction", "form_correction", "CLEAR", ("Formulir operasional perlu diperbaiki sebelum proses administrasi diteruskan.", "Berkas yang salah isi dikembalikan untuk koreksi dokumen.", "Petugas meninjau kelengkapan formulir sesuai daftar periksa administrasi.")),
    ("ADMINISTRATION", "SHUTTLE", "admin-settlement-document", "settlement_documentation", "AMBIGUOUS_REVIEWED", ("Dokumen pembagian hasil shuttle diperiksa; label ADMINISTRATION karena fokusnya adalah kelengkapan dokumen, bukan eksekusi pembayaran.", "Arsip persetujuan settlement ditelaah sebelum status administrasi diperbarui.", "Petugas memeriksa lampiran pembagian hasil untuk memastikan catatan formal lengkap.")),
    ("ADMINISTRATION", "OPERATIONS", "admin-frozen-retention", "retention_review", "CLEAR", ("Jadwal retensi dokumen diperiksa untuk memastikan arsip lama ditangani sesuai kebijakan.", "Administrasi meninjau daftar catatan yang memasuki masa retensi.", "Petugas menyusun bukti peninjauan retensi tanpa menghapus data pada catatan ini.")),
    ("ADMINISTRATION", "FUNDING", "admin-frozen-report", "report_preparation", "CLEAR", ("Laporan administrasi simpanan disiapkan dengan memeriksa kelengkapan referensi.", "Petugas mengompilasi dokumen pendukung untuk laporan unit dana.", "Berkas pelaporan ditata agar peninjauan administrasi dapat dilakukan.")),
    ("ADMINISTRATION", "OPERATIONS", "admin-frozen-access", "access_review", "CLEAR", ("Daftar akses operasional ditinjau untuk memastikan hak pengguna sesuai peran.", "Administrasi memeriksa catatan persetujuan akses sebelum pembaruan dilakukan.", "Petugas menyiapkan bukti peninjauan hak akses untuk audit internal.")),
)

_SPLIT_BY_FAMILY_POSITION = ("TRAIN", "TRAIN", "TRAIN", "TRAIN", "TRAIN", "TRAIN", "VALIDATION", "VALIDATION", "VALIDATION", "TEST", "TEST", "TEST")


def split_manifest(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Build a reviewable manifest; frozen test family membership is explicit."""
    validated = validate_activity_records(records)
    families = {split: sorted({record.get("template_family", "") for record in validated if record["split"] == split}) for split in SPLITS}
    return {"dataset_version": DATASET_VERSION, "label_version": LABEL_VERSION, "dataset_sha256": dataset_sha256(validated),
            "record_count": len(validated), "families_by_split": families, "frozen_final_holdout": families["TEST"],
            "class_distribution": {split: class_distribution(record for record in validated if record["split"] == split) for split in SPLITS}}


def generate_synthetic_activity_records(seed: int = 20261105, examples_per_family: int = 3) -> list[dict[str, str]]:
    """Create a deterministic v0.2 corpus with fixed, group-aware splits."""
    if examples_per_family < 2 or examples_per_family > 3:
        raise ValueError("examples_per_family must be between 2 and 3 for the reviewed v0.2 scenarios")
    start = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
    family_positions: dict[str, int] = defaultdict(int)
    records: list[dict[str, str]] = []
    for ordinal, (label, unit, family, primary_action, review_status, notes) in enumerate(_SCENARIOS):
        family_position = family_positions[label]
        family_positions[label] += 1
        split = _SPLIT_BY_FAMILY_POSITION[family_position]
        for example, note in enumerate(notes[:examples_per_family]):
            day_offset = ordinal * examples_per_family + example
            records.append({"activity_id": f"act-syn-v02-{seed}-{ordinal:02d}-{example:02d}",
                            "occurred_at": (start + timedelta(days=day_offset)).isoformat().replace("+00:00", "Z"),
                            "business_unit": unit, "note_deidentified": note, "category_label": label,
                            "source_type": "SYNTHETIC", "label_version": LABEL_VERSION,
                            "provenance": f"synthetic-generator-v2; dataset={DATASET_VERSION}; seed={seed}; no-personal-data",
                            "split": split, "template_family": family, "semantic_group": family,
                            "primary_action": primary_action, "review_status": review_status})
    assert_leakage_safe(records)
    return records

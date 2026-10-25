"""Explicit full RAG validation path; it downloads the local embedding model when absent."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.rag import chroma_retrieve


def main() -> None:
    documents = [
        {
            "id": "shuttle-billing",
            "title": "Tagihan Shuttle",
            "content": "Invoice shuttle diterbitkan setiap bulan dan dapat dibayar melalui petugas keuangan.",
        },
        {
            "id": "store-stock",
            "title": "Stok Toko",
            "content": "Stok toko berubah setelah transaksi kasir tercatat.",
        },
    ]
    previous_directory = os.environ.get("NOVO_CHROMA_DIR")
    with tempfile.TemporaryDirectory(prefix="novo-rag-smoke-") as temporary_directory:
        os.environ["NOVO_CHROMA_DIR"] = str(Path(temporary_directory) / "chroma")
        try:
            passages = chroma_retrieve("bagaimana membayar invoice shuttle", documents)
        finally:
            if previous_directory is None:
                os.environ.pop("NOVO_CHROMA_DIR", None)
            else:
                os.environ["NOVO_CHROMA_DIR"] = previous_directory

    assert passages, "Expected at least one Chroma retrieval result."
    assert any("shuttle" in passage["content"].lower() for passage in passages)
    print("RAG embedding and Chroma smoke test passed.")


if __name__ == "__main__":
    main()

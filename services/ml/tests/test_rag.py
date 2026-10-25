import asyncio

from app.rag import answer_from_context, lexical_retrieve


def test_lexical_rag_returns_relevant_document_without_embedding_download() -> None:
    documents = [
        {"id": "shuttle", "title": "Panduan Shuttle", "content": "Pembayaran shuttle dilakukan melalui invoice bulanan."},
        {"id": "store", "title": "Panduan Toko", "content": "Stok toko diperbarui setelah transaksi kasir."},
    ]

    passages = lexical_retrieve("bagaimana pembayaran shuttle", documents)

    assert passages[0]["id"] == "shuttle"


def test_rag_context_fallback_answers_without_provider_key(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    answer, mode = asyncio.run(
        answer_from_context(
            "Bagaimana pembayaran?",
            [{"id": "shuttle", "title": "Panduan Shuttle", "content": "Pembayaran shuttle dilakukan melalui invoice bulanan."}],
        )
    )

    assert mode == "retrieval_only"
    assert "invoice bulanan" in answer

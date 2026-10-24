from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx


def lexical_retrieve(question: str, documents: list[dict[str, str]], limit: int = 3) -> list[dict[str, str]]:
    terms = {part.lower() for part in question.split() if len(part) > 2}
    ranked = sorted(documents, key=lambda doc: sum(term in (doc["title"] + " " + doc["content"]).lower() for term in terms), reverse=True)
    return ranked[:limit]


def chroma_retrieve(question: str, documents: list[dict[str, str]]) -> list[dict[str, str]]:
    """Persist documents in ChromaDB using a local embedding model. Raises on unavailable local dependencies."""
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

    directory = Path(os.getenv("NOVO_CHROMA_DIR", "./models/chroma"))
    client = chromadb.PersistentClient(path=str(directory))
    embedding = SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
    collection = client.get_or_create_collection("novo_knowledge", embedding_function=embedding)
    if documents:
        collection.upsert(ids=[doc["id"] for doc in documents], documents=[doc["content"] for doc in documents], metadatas=[{"title": doc["title"]} for doc in documents])
    result: dict[str, Any] = collection.query(query_texts=[question], n_results=min(3, max(1, len(documents))))
    texts = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    return [{"id": str(index), "title": (metas[index] or {}).get("title", "Dokumen NOVO"), "content": content} for index, content in enumerate(texts)]

async def answer_from_context(question: str, passages: list[dict[str, str]]) -> tuple[str, str]:
    if not passages:
        return "Saya belum memiliki dokumen operasional yang relevan. Tambahkan dokumen atau hubungi petugas NOVO.", "no_context"
    context = "\n\n".join(f"Judul: {item['title']}\nIsi: {item['content']}" for item in passages)
    key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    if key:
        response = await httpx.AsyncClient(timeout=25).post("https://api.openai.com/v1/responses", headers={"authorization": f"Bearer {key}"}, json={"model": model, "input": [{"role": "system", "content": "Jawab dalam Bahasa Indonesia hanya dari konteks NOVO berikut. Jika tidak cukup, katakan tidak tahu dan arahkan ke petugas. Jangan membuat angka atau kebijakan baru."}, {"role": "user", "content": f"Konteks:\n{context}\n\nPertanyaan: {question}"}]})
        if response.is_success:
            text = response.json().get("output_text", "").strip()
            if text:
                return text, "provider_generation"
    excerpt = passages[0]["content"].strip().replace("\n", " ")
    return f"Jawaban berbasis dokumen: {excerpt[:900]}", "retrieval_only"

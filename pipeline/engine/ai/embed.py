"""S4 embeddings: gte-small (384 dims), run locally with ONNX Runtime — free, no API, no GPU.

Supabase/gte-small is the same model Supabase's edge runtime serves, so questions typed into the
research agent (phase D) can be embedded with an identical model and compared like-for-like.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from functools import cached_property
from typing import Any

import numpy as np

log = logging.getLogger("engine.ai.embed")

MODEL_REPO = "Supabase/gte-small"
MODEL_FILE = "onnx/model_quantized.onnx"
MODEL_ID = f"{MODEL_REPO}@quantized"
DIM = 384
MAX_TOKENS = 512
BATCH = 32


class Embedder:
    @cached_property
    def _tokenizer(self):
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        tok = Tokenizer.from_file(hf_hub_download(MODEL_REPO, "tokenizer.json"))
        tok.enable_truncation(MAX_TOKENS)
        tok.enable_padding()
        return tok

    @cached_property
    def _session(self):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        return ort.InferenceSession(hf_hub_download(MODEL_REPO, MODEL_FILE), opts, providers=["CPUExecutionProvider"])

    def embed(self, texts: list[str]) -> np.ndarray:
        """Mean-pooled, L2-normalised sentence embeddings (the gte-small recipe)."""
        enc = self._tokenizer.encode_batch([t or "" for t in texts])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": mask}
        if any(i.name == "token_type_ids" for i in self._session.get_inputs()):
            feeds["token_type_ids"] = np.zeros_like(ids)
        hidden = self._session.run(None, feeds)[0]  # (batch, tokens, 384)
        m = mask[..., None].astype(np.float32)
        pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
        return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)


def text_for(row: dict[str, Any]) -> str:
    """English text to embed: the verified translation for Hindi/Hinglish, otherwise the original."""
    body = row["translation"] if row.get("translation") and row.get("translation_ok") else (row.get("text") or "")
    return f"{row['title']}. {body}" if row.get("title") else body


def to_pgvector(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v.tolist()) + "]"


def run_embedding(store: Any, embedder: Embedder, deadline: float) -> dict:
    stats = Counter()
    while time.time() < deadline:
        queue = store.queue_embedding(BATCH * 8)
        if not queue:
            break
        for i in range(0, len(queue), BATCH):
            if time.time() >= deadline:
                break
            batch = queue[i:i + BATCH]
            vecs = embedder.embed([text_for(r) for r in batch])
            store.upsert("item_embeddings", [
                {"source": r["source"], "source_id": r["source_id"], "model": MODEL_ID, "embedding": to_pgvector(v)}
                for r, v in zip(batch, vecs)
            ])
            stats["embedded"] += len(batch)
            stats["used_translation"] += sum(bool(r.get("translation") and r.get("translation_ok")) for r in batch)
    return dict(stats)

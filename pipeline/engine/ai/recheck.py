"""V9 re-check: the interviews challenged two engine themes, so re-read every entry behind them.

H1 (return fear) and H3 (quality / trust) were the engine's biggest barriers, but in the interviews the
barrier was rarely fear of a bad buy. Two questions test why the engine over-rated them:

  timing: was the writer holding back from a purchase (a barrier to trying) or complaining about an
          order they already received (not a barrier to trying)?
  kind:   for quality entries, is the doubt about authenticity, the condition on arrival, or whether the
          item suits the person (size, fit, variant, compatibility, ripeness)?

Two models label every entry independently; results count only entries where they agree.
One-off research run, not a pipeline stage:  python -m engine.ai.recheck
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from pathlib import Path

from ..config import SETTINGS
from .db import AIStore
from .groq import GroqClient
from .validation import cohen_kappa

log = logging.getLogger(__name__)

MODELS = ("openai/gpt-oss-20b", "qwen/qwen3.8-27b")
BATCH = 10
OUT = Path(__file__).resolve().parents[3] / "docs" / "data" / "v9-recheck.json"
RETURN, QUALITY = "return_refund_friction", ("quality_trust", "authenticity")
TIMING = ("before_trying", "after_purchase", "unclear")
KIND = ("authenticity", "arrival_condition", "suitability", "none")

SYSTEM = """You read customer feedback about Blinkit (Indian quick commerce). For each entry return two labels.

timing (exactly one):
- before_trying: the writer holds back, hesitates, or avoids buying something because of a concern;
  the concern stops or delays a purchase.
- after_purchase: the writer reports a problem with an order they already received, or a return or refund
  they already tried.
- unclear: you cannot tell.

kind (exactly one), the product-quality concern if any:
- authenticity: whether the product is genuine (fake, duplicate, counterfeit, tampered seal).
- arrival_condition: what arrived was damaged, stale, expired, rotten, spoiled, or worse than expected.
- suitability: whether the item is right for this person: size, fit, compatibility, exact variant or
  flavour, ripeness, specifications they could not judge from the listing.
- none: no product-quality concern (delivery, app, support, price only).

Return ONLY JSON: {"items": [{"id": <id>, "timing": "...", "kind": "..."}]} with one object per entry."""


def load_pool(store: AIStore) -> list[dict]:
    r = store.http.get("/item_tags", params={
        "select": "source,source_id,barriers,translation,raw_items(text,title,rating)",
        "or": f"(barriers.cs.{{{RETURN}}},barriers.cs.{{{QUALITY[0]}}},barriers.cs.{{{QUALITY[1]}}})",
        "order": "source,source_id", "limit": "2000"})
    r.raise_for_status()
    return r.json()


def payload(batch: list[dict]) -> str:
    out = []
    for i, row in enumerate(batch):
        raw = row["raw_items"] or {}
        text = row.get("translation") or raw.get("text") or ""
        if raw.get("title"):
            text = f"{raw['title']}. {text}"
        out.append({"id": i, "stars": raw.get("rating"), "text": text[:1500]})
    return json.dumps(out, ensure_ascii=False)


def label(groq: GroqClient, model: str, batch: list[dict]) -> list[dict]:
    res = groq.chat_json(model=model, system=SYSTEM, user=payload(batch), stage="v9_recheck",
                         items=len(batch), max_tokens=40 * len(batch) + 600)
    got = {o.get("id"): o for o in res.data.get("items", []) if isinstance(o, dict)}
    out = []
    for i in range(len(batch)):
        o = got.get(i, {})
        t, k = o.get("timing"), o.get("kind")
        out.append({"timing": t if t in TIMING else None, "kind": k if k in KIND else None})
    return out


def split(labels: list[tuple], allowed: tuple) -> dict:
    """Agreement between the two models, and the share of each label among entries where they agree."""
    pairs = [(a, b) for a, b in labels if a and b]
    agreed = [a for a, b in pairs if a == b]
    counts = Counter(agreed)
    return {
        "entries": len(labels), "both_labelled": len(pairs), "agreed": len(agreed),
        "agreement": round(len(agreed) / len(pairs), 3) if pairs else None,
        "kappa": round(k, 3) if (k := cohen_kappa([a for a, _ in pairs], [b for _, b in pairs])) is not None else None,
        "counts": {v: counts.get(v, 0) for v in allowed},
        "shares": {v: round(counts.get(v, 0) / len(agreed), 3) if agreed else None for v in allowed},
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    store = AIStore()
    groq = GroqClient(api_key=SETTINGS.groq_api_key, log_call=store.log_call,
                      tpm_reserve={"qwen/qwen3.8-27b": 4_000})
    pool = load_pool(store)
    log.info("%d entries", len(pool))
    labels: dict[str, list[dict]] = {m: [] for m in MODELS}
    for m in MODELS:
        for i in range(0, len(pool), BATCH):
            labels[m] += label(groq, m, pool[i:i + BATCH])
            log.info("%s: %d/%d", m, len(labels[m]), len(pool))

    a, b = (labels[m] for m in MODELS)
    items = [{"source": r["source"], "source_id": r["source_id"], "barriers": r["barriers"],
              **{f"{f}_{n}": lab[f] for n, lab in (("a", x), ("b", y)) for f in ("timing", "kind")}}
             for r, x, y in zip(pool, a, b)]
    ret = [it for it in items if RETURN in it["barriers"]]
    qual = [it for it in items if set(QUALITY) & set(it["barriers"])]
    result = {
        "models": list(MODELS),
        "pool": len(items),
        "return_timing": split([(it["timing_a"], it["timing_b"]) for it in ret], TIMING),
        "quality_timing": split([(it["timing_a"], it["timing_b"]) for it in qual], TIMING),
        "quality_kind": split([(it["kind_a"], it["kind_b"]) for it in qual], KIND),
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "items"}, indent=1))


if __name__ == "__main__":
    main()

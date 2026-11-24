"""S5 theme discovery: themes emerge from the data instead of being pre-defined.

1. Load embeddings of all tagged entries (gte-small, 384 dims).
2. UMAP reduces them to a few dimensions; HDBSCAN finds dense groups and leaves outliers out.
3. Code computes each theme's statistics (size, rating intensity, % negative, top barriers and
   categories, sources, monthly trend) — the model never does arithmetic.
4. gpt-oss-120b names and describes each theme from its most representative *verified* quotes
   and those statistics.
5. Everything is written as a new snapshot, published only if every theme was named.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from typing import Any

import numpy as np

from . import prompts
from .groq import BudgetExhausted, GroqClient, ModelOutputError, RateLimited
from .taxonomy import taxonomy

log = logging.getLogger("engine.ai.themes")

MIN_ITEMS = 200          # below this, clusters are too thin to call "themes"
REP_FOR_MODEL = 12       # quotes shown to the namer
REP_STORED = 5           # quotes shown on the website
KINDS = ("exploration_barrier", "habit", "discovery", "information_need", "general_friction", "positive_experience")

RESEARCH_QUESTIONS = {
    1: "Why do users repeatedly buy from the same categories?",
    2: "What prevents users from exploring new categories?",
    3: "How do users discover products today?",
    4: "What role do habits play in shopping behaviour?",
    5: "What information do users need before trying a new category?",
    6: "What frustrations emerge repeatedly?",
    7: "Which user segments are more likely to experiment?",
    8: "What unmet needs emerge consistently across discussions?",
}

NAMER_SYSTEM = f"""You name themes discovered by clustering customer feedback about Blinkit (Indian quick commerce)
for a study of why shoppers stick to the same product categories and what stops them trying new ones.

You get statistics computed from the cluster and a sample of verbatim quotes. Return JSON:
{{"name": "<3-7 words, specific, plain English>",
  "description": "<1-2 sentences stating what these users say, grounded in the quotes; no numbers>",
  "kind": one of {list(KINDS)},
  "questions": [ids of the research questions this theme helps answer]}}

Research questions: {json.dumps(RESEARCH_QUESTIONS)}

Rules: describe only what the quotes show. Do not invent causes, numbers or quotes. Prefer a specific
name ("Fear of expired dairy and bakery items") over a generic one ("Quality issues")."""


def cluster(emb: np.ndarray, seed: int = 42) -> tuple[np.ndarray, dict[str, Any]]:
    """Returns cluster labels (-1 = outlier) and the parameters used, for the snapshot record."""
    import umap
    from sklearn.cluster import HDBSCAN

    n = len(emb)
    # Pinned for reproducibility: fixed seed (which needs n_jobs=1), and UMAP's current layout
    # algorithm so a library upgrade can't silently change which themes are found.
    params = {"umap": {"n_neighbors": 15, "n_components": 8, "min_dist": 0.0, "metric": "cosine", "random_state": seed,
                       "n_jobs": 1, "compatibility_layout": True},
              "hdbscan": {"min_cluster_size": max(12, round(n * 0.01)), "min_samples": 5, "copy": True}}
    reduced = umap.UMAP(**params["umap"]).fit_transform(emb)
    labels = HDBSCAN(**params["hdbscan"]).fit_predict(reduced)
    return labels, params


def theme_stats(rows: list[dict]) -> dict[str, Any]:
    bars = Counter(b for r in rows for b in (r.get("barriers") or []))
    cats = Counter(c for r in rows for c in (r.get("categories") or []))
    ratings = [r["rating"] for r in rows if r.get("rating")]
    n = len(rows)
    return {
        "size": n,
        "avg_rating": round(float(np.mean(ratings)), 2) if ratings else None,
        "pct_negative": round(100 * sum(r.get("sentiment") == "negative" for r in rows) / n, 1) if n else None,
        "top_barriers": [[k, v] for k, v in bars.most_common(4)],
        "top_categories": [[k, v] for k, v in cats.most_common(4)],
        "sources": dict(Counter(r["source"] for r in rows)),
        "monthly": dict(sorted(Counter((r.get("posted_at") or "")[:7] for r in rows).items())),
    }


def representatives(idx: np.ndarray, emb: np.ndarray, rows: list[dict], k: int) -> list[int]:
    """Indices of the k entries closest to the theme's centre, preferring verified quotes."""
    centre = emb[idx].mean(axis=0)
    centre /= np.linalg.norm(centre) or 1
    order = idx[np.argsort(-(emb[idx] @ centre))]
    grounded = [i for i in order if rows[i].get("evidence_grounded")]
    rest = [i for i in order if not rows[i].get("evidence_grounded")]
    return (grounded + rest)[:k]


def name_theme(groq: GroqClient, stats: dict, quotes: list[str]) -> dict[str, Any]:
    vocab = taxonomy()
    readable = {
        "entries": stats["size"],
        "average_star_rating": stats["avg_rating"],
        "percent_negative": stats["pct_negative"],
        "top_barriers": [vocab["barriers"].get(k, k) for k, _ in stats["top_barriers"]],
        "top_categories": [vocab["categories"].get(k, k) for k, _ in stats["top_categories"]],
    }
    res = groq.chat_json(model=prompts.MODEL_TAGGING, system=NAMER_SYSTEM, stage="theme_naming", items=1,
                         user=json.dumps({"statistics": readable, "quotes": quotes}, ensure_ascii=False),
                         max_tokens=900)
    d = res.data if isinstance(res.data, dict) else {}
    name = str(d.get("name") or "").strip()[:80]
    desc = str(d.get("description") or "").strip()[:400]
    if not name or not desc:
        raise ModelOutputError("theme without name or description")
    kind = d.get("kind") if d.get("kind") in KINDS else "general_friction"
    qs = sorted({int(q) for q in (d.get("questions") or []) if str(q).isdigit() and 1 <= int(q) <= 8})
    return {"name": name, "description": desc, "kind": kind, "questions": qs}


CONSOLIDATE_SYSTEM = """You review themes discovered by clustering customer feedback about Blinkit (Indian
quick commerce). Clustering can split one underlying problem into several near-duplicate themes.

Group together ONLY themes that describe the same user problem with the same cause and the same product
scope. Keep themes separate when the product category differs (e.g. dairy vs. produce freshness), when the
cause differs (e.g. expired stock vs. damaged packaging), or when one is positive and the other negative.
When unsure, keep them separate.

Return JSON: {"merge": [[id, id, ...], ...]} listing only groups of two or more ids; each id at most once.
Return {"merge": []} if nothing should be merged."""


def consolidate(groq: GroqClient, named: dict[int, dict], stats: dict[int, dict]) -> list[list[int]]:
    """Asks the model which named themes are duplicates. Output is validated: unknown ids, repeated ids
    and single-member groups are discarded."""
    vocab = taxonomy()
    listing = [{"id": c, "name": named[c]["name"], "description": named[c]["description"],
                "top_barriers": [vocab["barriers"].get(k, k) for k, _ in stats[c]["top_barriers"][:3]],
                "top_categories": [vocab["categories"].get(k, k) for k, _ in stats[c]["top_categories"][:3]]}
               for c in named]
    res = groq.chat_json(model=prompts.MODEL_TAGGING, system=CONSOLIDATE_SYSTEM, stage="theme_consolidation",
                         items=len(listing), user=json.dumps(listing, ensure_ascii=False), max_tokens=900)
    seen: set[int] = set()
    groups: list[list[int]] = []
    for g in (res.data.get("merge") or []) if isinstance(res.data, dict) else []:
        ids = []
        for x in g if isinstance(g, list) else []:
            try:
                i = int(x)
            except (TypeError, ValueError):
                continue
            if i in named and i not in seen and i not in ids:
                ids.append(i)
        if len(ids) >= 2:
            seen.update(ids)
            groups.append(sorted(ids))
    return groups


def run_themes(store: Any, groq: GroqClient) -> dict[str, Any]:
    keys, emb = store.load_embeddings()
    if len(keys) < MIN_ITEMS:
        return {"skipped": f"only {len(keys)} embedded entries; need {MIN_ITEMS}"}
    rows_by_key = store.load_theme_inputs()
    rows = [rows_by_key.get(k, {"source": k[0], "source_id": k[1]}) for k in keys]
    labels, params = cluster(emb)
    clusters = sorted({int(l) for l in labels if l >= 0})
    noise = int((labels < 0).sum())
    clustered = len(keys) - noise
    # 1) statistics + names per cluster
    idx_of = {c: np.where(labels == c)[0] for c in clusters}
    stats, named = {}, {}

    def describe(idx: np.ndarray) -> tuple[dict, list[int], dict]:
        st = theme_stats([rows[i] for i in idx])
        reps = representatives(idx, emb, rows, max(REP_FOR_MODEL, REP_STORED))
        quotes = [(rows[i].get("evidence_span") if rows[i].get("evidence_grounded") else None)
                  or (rows[i].get("text") or "")[:300] for i in reps[:REP_FOR_MODEL]]
        return st, reps, name_theme(groq, st, quotes)

    reps_of = {}
    try:
        for c in clusters:
            stats[c], reps_of[c], named[c] = describe(idx_of[c])
        # 2) consolidation: merge near-duplicate themes, then re-describe the merged groups
        merges = consolidate(groq, named, stats) if len(clusters) > 1 else []
        for group in merges:
            keep = group[0]
            idx_of[keep] = np.concatenate([idx_of[c] for c in group])
            for c in group[1:]:
                del idx_of[c], stats[c], named[c], reps_of[c]
            stats[keep], reps_of[keep], named[keep] = describe(idx_of[keep])
    except (BudgetExhausted, RateLimited, ModelOutputError) as exc:
        return {"skipped": f"theme naming stopped: {type(exc).__name__}", "clusters": len(clusters)}
    params["consolidation"] = {"clusters_found": len(clusters), "merged_groups": merges}

    # 3) rows to store
    themes, members = [], []
    for c, idx in idx_of.items():
        st, reps = stats[c], reps_of[c]
        themes.append({
            "theme_id": c, **named[c], "size": st["size"], "share": round(st["size"] / clustered, 4),
            "avg_rating": st["avg_rating"], "pct_negative": st["pct_negative"],
            "top_barriers": st["top_barriers"], "top_categories": st["top_categories"],
            "sources": st["sources"], "monthly": st["monthly"],
            "rep_keys": [[rows[i]["source"], rows[i]["source_id"]] for i in reps
                         if rows[i].get("evidence_grounded")][:REP_STORED],
        })
        centre = emb[idx].mean(axis=0)
        centre /= np.linalg.norm(centre) or 1
        sims = emb[idx] @ centre
        members += [{"theme_id": c, "source": rows[i]["source"], "source_id": rows[i]["source_id"],
                     "similarity": round(float(sim), 4)} for i, sim in zip(idx, sims)]
    # Publish gate: every theme named successfully (otherwise we returned above).
    snap = store.save_theme_snapshot(items=len(keys), noise=noise, params=params, model=prompts.MODEL_TAGGING,
                                     themes=themes, members=members)
    return {"snapshot": snap, "entries": len(keys), "clusters": len(clusters), "themes": len(themes),
            "merged": sum(len(g) - 1 for g in merges), "outliers": noise,
            "largest": max((t["size"] for t in themes), default=0)}

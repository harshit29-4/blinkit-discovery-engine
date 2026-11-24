"""Phase B validation: V1 cross-model agreement, V7 stability, and the metric computation for
V1–V8 shown on the Validation page. Metrics are computed in code from stored data, never by a model."""

from __future__ import annotations

import json
import time
from collections import Counter
from datetime import date, timedelta
from typing import Any

from . import prompts
from .groq import BudgetExhausted, GroqClient, ModelOutputError, RateLimited
from .taxonomy import allowed, taxonomy
from .validate import clean_tags

CROSS_VERSION = "cross-v2"  # bump together with prompts.core_field_rules changes
CROSS_BATCH = 10    # qwen: compact output keeps a request under its 1,000 output tokens/minute
STABILITY_BATCH = 8
CHECK_FIELDS_SINGLE = ("sentiment", "category_behavior", "funnel_stage")
CHECK_FIELDS_MULTI = ("categories", "barriers")


def crosscheck_system() -> str:
    """Same field definitions as the production tagger (prompts.core_field_rules), fewer fields."""
    return f"""You annotate customer feedback about Blinkit (Indian quick commerce) for a research study on
category exploration. For each entry return ONLY these fields, using ONLY the listed values:
- "id": the entry id
{prompts.core_field_rules()}
Tag only what is stated. Return compact JSON: {{"items": [...]}}"""


def _batches(store_fn, size: int, deadline: float, *args, stage: str = ""):
    from .stages import _fetch

    while time.time() < deadline:
        queue = _fetch(stage, lambda n: store_fn(n, *args), size * 5, deadline)
        if not queue:
            return
        for i in range(0, len(queue), size):
            if time.time() >= deadline:
                return
            yield queue[i:i + size]


def _subset(t: dict) -> dict:
    return {f: t[f] for f in CHECK_FIELDS_SINGLE + CHECK_FIELDS_MULTI}


def run_crosscheck(store: Any, groq: GroqClient, deadline: float) -> dict:
    """V1: a different model family independently re-tags a 10% sample."""
    stats = Counter()
    system = crosscheck_system()
    for batch in _batches(store.queue_crosscheck, CROSS_BATCH, deadline, stage="crosscheck"):
        try:
            res = groq.chat_json(model=prompts.MODEL_CHECK, system=system, user=prompts.entries_payload(batch),
                                 stage="crosscheck", items=len(batch), max_tokens=45 * len(batch) + 150)
        except BudgetExhausted:
            stats["stopped_daily_limit"] = 1
            break
        except RateLimited:
            stats["paused_rate_limit"] = 1
            break
        except ModelOutputError:
            stats["failed_items"] += len(batch)
            continue
        answers = {str(a.get("id")): a for a in (res.data.get("items") or []) if isinstance(a, dict)}
        rows = []
        for pos, r in enumerate(batch, 1):
            a = answers.get(str(pos))
            if not a:
                continue
            rows.append({"source": r["source"], "source_id": r["source_id"], "model": prompts.MODEL_CHECK,
                         "prompt_version": CROSS_VERSION, **_subset(clean_tags(a).tags)})
        if rows:
            store.upsert("item_crosscheck", rows)
            stats["crosschecked"] += len(rows)
        else:
            stats["failed_items"] += len(batch)
            break  # no usable answers: don't spin on the same batch this run
    return dict(stats)


def iso_week(today: date | None = None) -> date:
    d = today or date.today()
    return d - timedelta(days=d.weekday())


def run_stability(store: Any, groq: GroqClient, deadline: float) -> dict:
    """V7: once a week the production tagger re-tags a fixed panel; agreement with its own earlier
    tags shows how stable the tagging is."""
    stats = Counter()
    week = iso_week()
    system = prompts.tagging_system()
    for batch in _batches(store.queue_stability, STABILITY_BATCH, deadline, week.isoformat(), stage="stability"):
        try:
            res = groq.chat_json(model=prompts.MODEL_TAGGING, system=system, user=prompts.entries_payload(batch),
                                 stage="stability", items=len(batch), max_tokens=260 * len(batch) + 300)
        except BudgetExhausted:
            stats["stopped_daily_limit"] = 1
            break
        except RateLimited:
            stats["paused_rate_limit"] = 1
            break
        except ModelOutputError:
            stats["failed_items"] += len(batch)
            continue
        answers = {str(a.get("id")): a for a in (res.data.get("items") or []) if isinstance(a, dict)}
        rows = []
        for pos, r in enumerate(batch, 1):
            a = answers.get(str(pos))
            if a:
                t = clean_tags(a).tags
                rows.append({"source": r["source"], "source_id": r["source_id"], "run_week": week.isoformat(),
                             "prompt_version": prompts.PROMPT_VERSION,
                             "sentiment": t["sentiment"], "categories": t["categories"], "barriers": t["barriers"],
                             "funnel_stage": t["funnel_stage"]})
        if rows:
            store.upsert("item_stability", rows, on_conflict="source,source_id,run_week")
            stats["retagged"] += len(rows)
        else:
            break
    return dict(stats)


# ---------------------------------------------------------------- metric maths

def cohen_kappa(a: list, b: list) -> float | None:
    """Agreement between two raters on categorical labels, corrected for chance."""
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb.get(k, 0) for k in ca) / (n * n)
    if pe >= 1:
        return 1.0 if po == 1 else 0.0
    return (po - pe) / (1 - pe)


def multilabel_agreement(a: list[list[str]], b: list[list[str]], labels: set[str], min_support: int = 5) -> dict:
    """Per-label kappa (present/absent), macro-averaged over labels with enough support, plus mean Jaccard."""
    per = {}
    for lab in sorted(labels):
        xa = [lab in x for x in a]
        xb = [lab in y for y in b]
        if sum(xa) + sum(xb) >= min_support:
            per[lab] = cohen_kappa(xa, xb)
    jacc = [len(set(x) & set(y)) / len(set(x) | set(y)) if (x or y) else 1.0 for x, y in zip(a, b)]
    vals = [v for v in per.values() if v is not None]
    return {"kappa": sum(vals) / len(vals) if vals else None, "per_label": per,
            "jaccard": sum(jacc) / len(jacc) if jacc else None}


def stars_to_sentiment(rating: int | None) -> str | None:
    if rating in (1, 2):
        return "negative"
    if rating in (4, 5):
        return "positive"
    return None


def compute_metrics(store: Any) -> dict[str, Any]:
    """Computes every validation metric from stored data and appends them to validation_metrics."""
    tags = store.load_tags_for_validation()      # key -> production tags (+ rating, raw, grounded, translation)
    cross = store.load_table_by_key("item_crosscheck")
    stab = store.load_table_by_key("item_stability", latest_week=True)
    funnel = store.load_funnel()
    state = {"learned_screen": store.get_state("learned_screen")} if hasattr(store, "get_state") else {}
    out: list[dict] = []

    def put(metric: str, value: float | None, n: int, **details):
        out.append({"metric": metric, "value": None if value is None else round(float(value), 4), "n": n,
                    "details": json.loads(json.dumps(details, default=str))})

    # V1 cross-model agreement: only pairs where both sides used the current instructions, so the score
    # measures disagreement between models, not between differently worded prompts.
    current = {k: t for k, t in tags.items() if t.get("prompt_version") in (None, prompts.PROMPT_VERSION)}
    pairs = [(current[k], c) for k, c in cross.items() if k in current and c.get("prompt_version") in (None, CROSS_VERSION)]
    for f in CHECK_FIELDS_SINGLE:
        a = [p[0].get(f) or "none" for p in pairs]
        b = [p[1].get(f) or "none" for p in pairs]
        put(f"v1_{f}", cohen_kappa(a, b), len(pairs), versions=[prompts.PROMPT_VERSION, CROSS_VERSION],
            agreement=(sum(x == y for x, y in zip(a, b)) / len(a)) if a else None)
    for f in CHECK_FIELDS_MULTI:
        m = multilabel_agreement([p[0].get(f) or [] for p in pairs], [p[1].get(f) or [] for p in pairs], allowed(f))
        put(f"v1_{f}", m["kappa"], len(pairs), jaccard=m["jaccard"], per_label=m["per_label"])

    # V2 AI sentiment vs the reviewer's own stars (clear cases only: 1–2 vs 4–5 stars, AI positive/negative)
    v2 = [(stars_to_sentiment(t.get("rating")), t.get("sentiment")) for t in tags.values()]
    v2 = [(s, ai) for s, ai in v2 if s and ai in ("positive", "negative")]
    conf = Counter(f"stars_{s}|ai_{ai}" for s, ai in v2)
    put("v2_sentiment_vs_stars", (sum(s == ai for s, ai in v2) / len(v2)) if v2 else None, len(v2), confusion=conf,
        excluded="3-star reviews, Reddit (no stars) and entries the AI rated neutral or mixed")

    # V3 grounding
    n = len(tags)
    put("v3_grounding", (sum(bool(t.get("evidence_grounded")) for t in tags.values()) / n) if n else None, n)

    # V4 schema: share of entries whose raw model output needed no value discarded
    from .validate import clean_tags as _clean
    clean = sum(1 for t in tags.values() if t.get("raw") and not _clean(t["raw"]).dropped)
    put("v4_schema", (clean / n) if n else None, n)

    # V6 keyword-screen recall estimate (from the control sample)
    f = funnel or {}
    if f.get("control_checked"):
        ctrl_rate = f["control_relevant"] / f["control_checked"]
        cand_rate = f["candidates_relevant"] / f["candidates_checked"] if f.get("candidates_checked") else 0
        found = cand_rate * f["candidates"]
        # Entries without a keyword hit: still 'excluded', moved to 'promoted' by the learned screen, or control.
        no_keyword = f["excluded"] + f.get("promoted", 0) + f["control_sample"]
        missed = ctrl_rate * no_keyword
        put("v6_keyword_recall", found / (found + missed) if (found + missed) else None, f["control_checked"],
            control_relevant_rate=ctrl_rate, candidate_relevant_rate=cand_rate)
        # V6b: keywords + learned screen. The screen's recall on entries with no keyword hit is measured by
        # cross-validation on the control sample (engine/ai/learned_screen.py), and applies once those
        # entries have been scored (`coverage`).
        ls = (state or {}).get("learned_screen") or {}
        if ls.get("control_recall") is not None and (found + missed):
            coverage = f.get("scored", 0) / max(f["excluded"] + f.get("promoted", 0), 1)
            caught = missed * ls["control_recall"] * min(coverage, 1.0)
            put("v6b_screen_recall", (found + caught) / (found + missed), ls.get("control_n", 0),
                screen_recall_no_keyword=ls["control_recall"], screen_precision_no_keyword=ls.get("control_precision"),
                auc=ls.get("auc"), coverage=round(coverage, 4), keyword_only=found / (found + missed))

    # V7 stability (latest weekly panel vs the production tags)
    sp = [(current[k], s) for k, s in stab.items() if k in current and s.get("prompt_version") in (None, prompts.PROMPT_VERSION)]
    if sp:
        agree = {fld: sum((x[0].get(fld) or ([] if fld in CHECK_FIELDS_MULTI else "none")) ==
                          (x[1].get(fld) or ([] if fld in CHECK_FIELDS_MULTI else "none")) for x in sp) / len(sp)
                 for fld in ("sentiment", "funnel_stage")}
        bar = multilabel_agreement([x[0].get("barriers") or [] for x in sp], [x[1].get("barriers") or [] for x in sp],
                                   allowed("barriers"), min_support=3)
        put("v7_stability", sum(agree.values()) / len(agree), len(sp), exact_agreement=agree,
            barriers_jaccard=bar["jaccard"], week=next(iter(stab.values())).get("run_week"))

    # V8 translation check
    checked = [t for t in tags.values() if t.get("translation_score") is not None]
    put("v8_translation", (sum(bool(t.get("translation_ok")) for t in checked) / len(checked)) if checked else None,
        len(checked))

    store.insert_metrics(out)
    return {m["metric"]: m["value"] for m in out}

"""Phase A stages. Each pulls work from a database queue, processes it in batches within a time
budget, and stops cleanly on a daily model limit. Re-running is always safe: queues only return
unfinished work, and a batch that keeps failing is retired after 3 attempts."""

from __future__ import annotations

import json
import logging
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Protocol

from . import prompts
from .groq import BudgetExhausted, GroqClient, ModelOutputError, RateLimited
from .prefilter import screen
from .validate import clean_tags, is_grounded

log = logging.getLogger("engine.ai")

# Larger batches amortise the fixed instructions over more entries: Groq's free tier caps each model
# at roughly 200k tokens/day, so tokens per entry decide daily throughput.
RELEVANCE_BATCH = 30
TAG_BATCH = 12
CHECK_BATCH = 10  # qwen: keeps one check request well under its 1,000 output tokens/minute
TRANSLATION_PASS = 0.7


class Store(Protocol):
    def queue_screen(self, n: int) -> list[dict]: ...
    def queue_relevance(self, n: int) -> list[dict]: ...
    def queue_tagging(self, n: int) -> list[dict]: ...
    def queue_translation_check(self, n: int) -> list[dict]: ...
    def upsert(self, table: str, rows: list[dict], on_conflict: str = ...) -> None: ...
    def mark_failed(self, keys: list[tuple[str, str]], err: str) -> None: ...


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _keys(rows: list[dict]) -> list[tuple[str, str]]:
    return [(r["source"], r["source_id"]) for r in rows]


def _by_id(data: dict, n: int) -> dict[int, dict]:
    """Maps the model's {"items":[{"id":"3",...}]} back to batch positions; ignores junk ids."""
    out: dict[int, dict] = {}
    for obj in (data.get("items") or []) if isinstance(data, dict) else []:
        try:
            i = int(str(obj.get("id")).strip())
        except (TypeError, ValueError, AttributeError):
            continue
        if 1 <= i <= n and i not in out:
            out[i] = obj
    return out


# Lanes run in parallel, so a downstream stage can find its queue empty only because the upstream
# stage hasn't produced work *yet*. Such a stage waits (polling) while its upstream is still running.
POLL_S = 20.0
_RUNNING: set[str] = set()
UPSTREAM = {"tag": "relevance", "translation": "tag", "crosscheck": "tag", "stability": "tag"}


def _fetch(stage: str, fetch, n: int, deadline: float) -> list[dict]:
    """Queue read. Waiting for upstream work is handled by the lane loop (see run_phase_a)."""
    return fetch(n)


SLICE_S = 300.0  # a lane gives each of its stages up to 5 minutes per turn
# Keys whose counts mean "this stage did work" (as opposed to flags like stopped_daily_limit).
_PROGRESS = {"tagged", "candidate_relevant", "candidate_not_relevant", "control_relevant", "control_not_relevant",
             "passed", "failed_check", "crosschecked", "retagged", "failed_items", "unanswered"}
_TERMINAL = {"stopped_daily_limit", "paused_rate_limit", "error", "skipped"}


def _merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        out[k] = out.get(k, 0) + v if isinstance(v, (int, float)) and isinstance(out.get(k, 0), (int, float)) else v
    return out


# ---------------------------------------------------------------- S1 pre-filter (no AI)

def run_screen(store: Store, deadline: float, page: int = 1000) -> dict:
    stats = Counter()
    while time.time() < deadline:
        rows = store.queue_screen(page)
        if not rows:
            break
        out = []
        for r in rows:
            s = screen(r["source"], r["source_id"], r.get("title"), r.get("text") or "", (r.get("meta") or {}).get("post_title"))
            out.append({"source": r["source"], "source_id": r["source_id"], "lang": s.lang,
                        "keyword_hits": list(s.hits), "pool": s.pool, "screened_at": _now()})
            stats[s.pool] += 1
            stats[f"lang_{s.lang}"] += 1
        store.upsert("item_screen", out)
        stats["screened"] += len(out)
    return dict(stats)


# ---------------------------------------------------------------- S2 relevance gate

def run_relevance(store: Store, groq: GroqClient, deadline: float) -> dict:
    stats = Counter()
    while time.time() < deadline:
        queue = store.queue_relevance(RELEVANCE_BATCH * 10)
        if not queue:
            break
        for i in range(0, len(queue), RELEVANCE_BATCH):
            if time.time() >= deadline:
                break
            batch = queue[i:i + RELEVANCE_BATCH]
            try:
                res = groq.chat_json(model=prompts.MODEL_RELEVANCE, system=prompts.RELEVANCE_SYSTEM,
                                     user=prompts.entries_payload(batch), stage="relevance",
                                     items=len(batch), max_tokens=60 * len(batch) + 700)
            except BudgetExhausted:
                stats["stopped_daily_limit"] = 1
                return dict(stats)
            except RateLimited:
                stats["paused_rate_limit"] = 1
                return dict(stats)
            except ModelOutputError as exc:
                store.mark_failed(_keys(batch), f"relevance: {exc}")
                stats["failed_items"] += len(batch)
                continue
            answers = _by_id(res.data, len(batch))
            rows, missing = [], []
            for pos, r in enumerate(batch, 1):
                a = answers.get(pos)
                if a is None or not isinstance(a.get("relevant"), bool):
                    missing.append(r)
                    continue
                verdict = "relevant" if a["relevant"] else "not_relevant"
                rows.append({"source": r["source"], "source_id": r["source_id"], "lang": r["lang"], "pool": r["pool"],
                             "relevance": verdict, "relevance_reason": str(a.get("reason") or "")[:120],
                             "relevance_model": f"{prompts.MODEL_RELEVANCE}@{prompts.RELEVANCE_VERSION}", "relevance_at": _now()})
                stats[f"{r['pool']}_{verdict}"] += 1
            if rows:
                store.upsert("item_screen", rows)
            if missing:  # model skipped some ids: retried on a later pass, retired after 3 tries
                store.mark_failed(_keys(missing), "relevance: no answer for item")
                stats["unanswered"] += len(missing)
    return dict(stats)


# ---------------------------------------------------------------- S3 tagging + translation

def _tag_rows(batch: list[dict], data: dict, stats: Counter) -> tuple[list[dict], list[dict]]:
    answers = _by_id(data, len(batch))
    rows, retry = [], []
    for pos, r in enumerate(batch, 1):
        a = answers.get(pos)
        if a is None:
            retry.append(r)
            continue
        c = clean_tags(a)
        stats["schema_drops"] += len(c.dropped)
        t = c.tags
        grounded = is_grounded(t["evidence_span"], r.get("text"), r.get("title"))
        if not grounded:
            retry.append(r)
        needs_translation = r.get("lang") in ("hi", "hinglish")
        rows.append({
            "source": r["source"], "source_id": r["source_id"],
            "model": prompts.MODEL_TAGGING, "prompt_version": prompts.PROMPT_VERSION, "tagged_at": _now(),
            "sentiment": t["sentiment"], "categories": t["categories"], "category_behavior": t["category_behavior"],
            "barriers": t["barriers"], "funnel_stage": t["funnel_stage"], "discovery_channels": t["discovery_channels"],
            "habit_signal": t["habit_signal"], "info_needs": t["info_needs"], "segment_signals": t["segment_signals"],
            "unmet_need": t["unmet_need"], "evidence_span": t["evidence_span"], "evidence_grounded": grounded,
            "translation": t["translation"] if needs_translation else None,
            "confidence": t["confidence"], "raw": a,
        })
    return rows, retry


def run_tagging(store: Store, groq: GroqClient, deadline: float) -> dict:
    stats = Counter()
    system = prompts.tagging_system()
    while time.time() < deadline:
        queue = _fetch("tag", store.queue_tagging, TAG_BATCH * 10, deadline)
        if not queue:
            break
        for i in range(0, len(queue), TAG_BATCH):
            if time.time() >= deadline:
                break
            batch = queue[i:i + TAG_BATCH]
            try:
                res = groq.chat_json(model=prompts.MODEL_TAGGING, system=system, user=prompts.entries_payload(batch),
                                     stage="tagging", items=len(batch), max_tokens=200 * len(batch) + 800)
            except BudgetExhausted:
                stats["stopped_daily_limit"] = 1
                return dict(stats)
            except RateLimited:
                stats["paused_rate_limit"] = 1
                return dict(stats)
            except ModelOutputError as exc:
                store.mark_failed(_keys(batch), f"tagging: {exc}")
                stats["failed_items"] += len(batch)
                continue
            rows, retry = _tag_rows(batch, res.data, stats)
            # V3: entries whose evidence quote wasn't verbatim (or that got no answer) get one more try,
            # alone, with the instruction repeated. If the retry is grounded it replaces the first answer.
            for r in retry:
                try:
                    res2 = groq.chat_json(model=prompts.MODEL_TAGGING, system=system + "\n\nIMPORTANT: evidence_span "
                                          "must be copied exactly from the text, character for character.",
                                          user=prompts.entries_payload([r]), stage="tagging_retry", items=1,
                                          max_tokens=600)
                except BudgetExhausted:
                    stats["stopped_daily_limit"] = 1
                    break
                except RateLimited:
                    stats["paused_rate_limit"] = 1
                    break
                except ModelOutputError:
                    continue
                again, _ = _tag_rows([r], res2.data, stats)
                if again:
                    rows = [x for x in rows if (x["source"], x["source_id"]) != (r["source"], r["source_id"])] + again
                    stats["retried_grounded" if again[0]["evidence_grounded"] else "retried_ungrounded"] += 1
            if rows:
                store.upsert("item_tags", rows)
                stats["tagged"] += len(rows)
                stats["grounded"] += sum(x["evidence_grounded"] for x in rows)
                stats["translated"] += sum(x["translation"] is not None for x in rows)
            untagged = [r for r in batch if (r["source"], r["source_id"]) not in {(x["source"], x["source_id"]) for x in rows}]
            if untagged:
                store.mark_failed(_keys(untagged), "tagging: no answer for item")
                stats["unanswered"] += len(untagged)
            if stats.get("stopped_daily_limit") or stats.get("paused_rate_limit"):
                return dict(stats)
    return dict(stats)


# ---------------------------------------------------------------- V8 translation check

def run_translation_check(store: Store, groq: GroqClient, deadline: float) -> dict:
    stats = Counter()
    while time.time() < deadline:
        queue = _fetch("translation", store.queue_translation_check, CHECK_BATCH * 5, deadline)
        if not queue:
            break
        for i in range(0, len(queue), CHECK_BATCH):
            if time.time() >= deadline:
                break
            batch = queue[i:i + CHECK_BATCH]
            pairs = [{"id": str(n), "original": r["text"], "english": r["translation"]} for n, r in enumerate(batch, 1)]
            try:
                res = groq.chat_json(model=prompts.MODEL_CHECK, system=prompts.TRANSLATION_CHECK_SYSTEM,
                                     user=json.dumps(pairs, ensure_ascii=False), stage="translation_check",
                                     items=len(batch), max_tokens=40 * len(batch) + 200)
            except BudgetExhausted:
                stats["stopped_daily_limit"] = 1
                return dict(stats)
            except RateLimited:
                stats["paused_rate_limit"] = 1
                return dict(stats)
            except ModelOutputError:
                stats["failed_items"] += len(batch)
                continue
            answers = _by_id(res.data, len(batch))
            rows = []
            for pos, r in enumerate(batch, 1):
                a = answers.get(pos)
                try:
                    score = min(max(float(a.get("score")), 0.0), 1.0) if a else None
                except (TypeError, ValueError):
                    score = None
                if score is None:
                    continue
                # The tag row already exists; model/prompt_version are only here because an upsert's
                # insert half must satisfy NOT NULL. Columns not listed are left untouched.
                rows.append({"source": r["source"], "source_id": r["source_id"],
                             "model": prompts.MODEL_TAGGING, "prompt_version": prompts.PROMPT_VERSION,
                             "translation_score": score, "translation_ok": score >= TRANSLATION_PASS})
                stats["passed" if score >= TRANSLATION_PASS else "failed_check"] += 1
            if rows:
                store.upsert("item_tags", rows)
    return dict(stats)


# ---------------------------------------------------------------- runner

STAGES = ("screen", "relevance", "tag", "translation",           # phase A
          "embed", "crosscheck", "stability", "themes", "metrics")  # phase B


# Which model each Groq stage uses. Stages on different models run in parallel lanes, because Groq's
# free-tier limits are per model: running them one after another left later stages starved (the first
# hourly run spent all 45 minutes on the relevance gate and never reached tagging).
LANE = {
    "relevance": prompts.MODEL_RELEVANCE,
    "tag": prompts.MODEL_TAGGING, "stability": prompts.MODEL_TAGGING,
    "translation": prompts.MODEL_CHECK, "crosscheck": prompts.MODEL_CHECK,
}
PRE = ("screen",)                      # before the lanes: decides what the AI stages see
POST = ("embed", "themes", "metrics")  # after the lanes, in reserved time: need the new tags


def _run_one(stage: str, store: Any, groq: GroqClient | None, deadline: float) -> dict:
    try:
        if stage == "screen":
            return run_screen(store, deadline)
        if stage == "embed":  # local model: no Groq needed
            from .embed import Embedder, run_embedding

            return run_embedding(store, Embedder(), deadline)
        if stage == "metrics":  # computed in code from stored data
            from .validation import compute_metrics

            return compute_metrics(store)
        if groq is None:
            return {"skipped": "GROQ_API_KEY not set"}
        if stage == "relevance":
            return run_relevance(store, groq, deadline)
        if stage == "tag":
            return run_tagging(store, groq, deadline)
        if stage == "translation":
            return run_translation_check(store, groq, deadline)
        if stage == "crosscheck":
            from .validation import run_crosscheck

            return run_crosscheck(store, groq, deadline)
        if stage == "stability":
            from .validation import run_stability

            return run_stability(store, groq, deadline)
        if stage == "themes":
            from .themes import run_themes

            return run_themes(store, groq)
        return {"skipped": "unknown stage"}
    except Exception as exc:  # one stage failing shouldn't stop the others
        log.exception("stage %s failed", stage)
        return {"error": f"{type(exc).__name__}: {exc}"}


def run_phase_a(store: Any, groq: GroqClient | None, stages: list[str], minutes: float) -> dict[str, Any]:
    """Runs the requested stages within `minutes`:
    1. pre-filter;
    2. Groq stages in parallel lanes, one per model (within a lane, in the order given);
    3. embeddings, themes and metrics in time reserved at the end.
    A stage that hits its model's daily limit stops; the others carry on."""
    from concurrent.futures import ThreadPoolExecutor

    start = time.time()
    deadline = start + minutes * 60
    post = [s for s in stages if s in POST]
    reserve = min(minutes * 60 * 0.3, (10 if "themes" in post else 4) * 60) if post else 0
    lane_deadline = deadline - reserve
    results: dict[str, Any] = {}

    for s in (s for s in stages if s in PRE):
        results[s] = _run_one(s, store, groq, lane_deadline)
        log.info("%s: %s", s, results[s])

    lanes: dict[str, list[str]] = {}
    for s in stages:
        if s in LANE:
            lanes.setdefault(LANE[s], []).append(s)

    def run_lane(lane_stages: list[str]) -> dict[str, dict]:
        """Cycles through the lane's stages in time slices until the deadline, so no stage starves
        another (e.g. a translation check waiting on tagging used to leave no time for the
        cross-check). Stops early once a full cycle does no work and nothing upstream is running."""
        out: dict[str, dict] = {s: {} for s in lane_stages}
        finished: set[str] = set()
        try:
            while time.time() < lane_deadline and len(finished) < len(lane_stages):
                progressed = False
                for s in lane_stages:
                    if s in finished or time.time() >= lane_deadline:
                        continue
                    r = _run_one(s, store, groq, min(lane_deadline, time.time() + SLICE_S))
                    out[s] = _merge(out[s], r)
                    if any(k in r for k in _TERMINAL):
                        finished.add(s)
                    if any(r.get(k) for k in _PROGRESS):
                        progressed = True
                if not progressed:
                    upstream_busy = any(UPSTREAM.get(s) in _RUNNING for s in lane_stages if s not in finished)
                    if not upstream_busy:
                        break
                    time.sleep(min(POLL_S, max(0.0, lane_deadline - time.time())))
        finally:
            _RUNNING.difference_update(lane_stages)
        for s in lane_stages:
            out[s] = out[s] or {"note": "no work pending"}
            log.info("%s: %s", s, out[s])
        return out

    if lanes:
        # Every lane stage counts as "running" until it finishes, so downstream stages wait for it.
        _RUNNING.update(s for group in lanes.values() for s in group)
        with ThreadPoolExecutor(max_workers=len(lanes)) as pool:
            for out in pool.map(run_lane, lanes.values()):
                results.update(out)

    for s in post:
        results[s] = _run_one(s, store, groq, deadline) if time.time() < deadline else {"skipped": "time budget used"}
        log.info("%s: %s", s, results[s])
    # Report in the order requested.
    return {s: results.get(s, {"skipped": "not run"}) for s in stages}

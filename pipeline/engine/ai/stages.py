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

RELEVANCE_BATCH = 20
TAG_BATCH = 8
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
                                     items=len(batch), max_tokens=120 * len(batch) + 400)
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
        queue = store.queue_tagging(TAG_BATCH * 10)
        if not queue:
            break
        for i in range(0, len(queue), TAG_BATCH):
            if time.time() >= deadline:
                break
            batch = queue[i:i + TAG_BATCH]
            try:
                res = groq.chat_json(model=prompts.MODEL_TAGGING, system=system, user=prompts.entries_payload(batch),
                                     stage="tagging", items=len(batch), max_tokens=260 * len(batch) + 300)
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
        queue = store.queue_translation_check(CHECK_BATCH * 5)
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

STAGES = ("screen", "relevance", "tag", "translation")


def run_phase_a(store: Any, groq: GroqClient | None, stages: list[str], minutes: float) -> dict[str, Any]:
    """Runs the requested stages in order within `minutes`. Later stages get whatever time is left;
    a stage that hits its model's daily limit stops, and the others carry on."""
    deadline = time.time() + minutes * 60
    results: dict[str, Any] = {}
    for stage in stages:
        if time.time() >= deadline:
            results[stage] = {"skipped": "time budget used"}
            continue
        try:
            if stage == "screen":
                results[stage] = run_screen(store, deadline)
            elif groq is None:
                results[stage] = {"skipped": "GROQ_API_KEY not set"}
            elif stage == "relevance":
                results[stage] = run_relevance(store, groq, deadline)
            elif stage == "tag":
                results[stage] = run_tagging(store, groq, deadline)
            elif stage == "translation":
                results[stage] = run_translation_check(store, groq, deadline)
        except Exception as exc:  # one stage failing shouldn't stop the others
            log.exception("stage %s failed", stage)
            results[stage] = {"error": f"{type(exc).__name__}: {exc}"}
        log.info("%s: %s", stage, results[stage])
    return results

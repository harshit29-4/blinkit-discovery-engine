"""Runs collectors into a store, with run logging and per-source cursors."""

from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone

from .collectors import COLLECTORS
from .config import SETTINGS
from .models import CursorAdvance, RawItem, ShortReview
from .store import Store

log = logging.getLogger("engine.collect")

FLUSH_EVERY = 100  # small, so an interrupted run keeps most of its progress
# Reddit yields two item sources; its cursor is tracked under one name. YouTube keeps per-query cursors.
CURSOR_SOURCES = {"play_store": "play_store", "app_store": "app_store", "reddit": "reddit_post",
                  "youtube": "youtube_comment"}


def collect_source(store: Store, name: str, mode: str, max_items: int | None) -> dict:
    """mode: 'backfill' walks back to the window start; 'incremental' stops just before the cursor."""
    window_start = SETTINGS.window_start()
    cursor = store.get_cursor(CURSOR_SOURCES[name])
    if mode == "incremental" and cursor:
        since = max(window_start, cursor - SETTINGS.incremental_overlap)
    else:
        since = window_start

    log.info("%s: %s run, collecting since %s", name, mode, since.date())
    collector = COLLECTORS[name]()
    if hasattr(collector, "known"):
        collector.known = store.existing_keys
    if hasattr(collector, "get_cursor"):
        collector.get_cursor = store.get_cursor
    buffer: list[RawItem] = []
    short_buffer: list[ShortReview] = []
    stats = {"seen": 0, "new": 0, "short_seen": 0, "since": since.isoformat()}
    newest: dict[str, datetime] = {}

    def flush() -> None:
        stats["new"] += store.upsert_raw(buffer)
        store.upsert_short(short_buffer)
        buffer.clear()
        short_buffer.clear()

    for item in collector.collect(since=since, max_items=max_items):
        if isinstance(item, CursorAdvance):
            flush()  # everything the cursor covers is stored before the cursor moves
            store.set_cursor(item.key, item.value)
            continue
        if isinstance(item, ShortReview):
            short_buffer.append(item)
            stats["short_seen"] += 1
        else:
            buffer.append(item)
            stats["seen"] += 1
        if item.posted_at > newest.get(item.source, since):
            newest[item.source] = item.posted_at
        if len(buffer) + len(short_buffer) >= FLUSH_EVERY * 5 or len(buffer) >= FLUSH_EVERY:
            flush()
            log.info("%s: %d seen (+%d short), %d new so far", name, stats["seen"], stats["short_seen"], stats["new"])
    flush()
    for counter in ("failed_windows", "failed_threads", "skipped_threads", "reused_threads", "stopped_early",
                    "disabled_comments", "units"):
        if getattr(collector, counter, 0):
            stats[counter] = getattr(collector, counter)

    # Collector-managed cursors (Reddit's per-subreddit frontiers) were already saved as
    # CursorAdvance markers arrived; record them in the run stats.
    if getattr(collector, "cursor_updates", None):
        stats["frontiers"] = {k: v.isoformat() for k, v in collector.cursor_updates.items()}

    # Only advance the cursor after everything is safely stored, and never past a gap:
    # if some search windows or threads failed, the next run must cover them again.
    if CURSOR_SOURCES[name] in newest and not (stats.get("failed_windows") or stats.get("failed_threads")):
        store.set_cursor(CURSOR_SOURCES[name], newest[CURSOR_SOURCES[name]])
    log.info("%s: done — %d seen, %d new", name, stats["seen"], stats["new"])
    return stats


def run_collect(store: Store, sources: list[str], mode: str, max_items: int | None, trigger: str) -> dict:
    run_id = store.start_run("collect", trigger)
    results: dict[str, dict] = {}
    failures = 0
    for name in sources:
        try:
            results[name] = collect_source(store, name, mode, max_items)
        except Exception as exc:  # keep going: one broken source shouldn't block the others
            failures += 1
            results[name] = {"error": f"{type(exc).__name__}: {exc}"}
            log.error("%s failed:\n%s", name, traceback.format_exc())
    status = "ok" if failures == 0 else ("failed" if failures == len(sources) else "partial")
    stats = {"mode": mode, "sources": results, "finished": datetime.now(timezone.utc).isoformat()}
    store.finish_run(run_id, status, stats)
    return {"run_id": run_id, "status": status, **stats}

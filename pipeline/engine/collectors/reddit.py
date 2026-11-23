"""Reddit posts and comments via the Arctic Shift archive API (free, no key).

Strategy: keyword-search posts in each configured subreddit, then pull the comments of
threads that are *about* Blinkit. Arctic Shift can't do comment-body search on busy
subreddits, so comments are reached through their threads.

Arctic Shift is a free, volunteer-run service with a per-IP rate limit. A run therefore
makes whatever progress it can and records, per subreddit, how far it got (a "frontier").
The next run resumes from there, so a long backfill completes over several hourly runs
without anyone watching.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

from ..config import SETTINGS
from ..models import CursorAdvance, RawItem
from ..util import HttpClient, PermanentHttpError, hash_author, to_utc

log = logging.getLogger("engine.reddit")

SKIP_AUTHORS = {"AutoModerator", "[deleted]"}
SKIP_BODIES = {"[deleted]", "[removed]", ""}
PAGE = 100
MIN_WINDOW = timedelta(days=8)      # stop splitting below ~a week; retry instead
STALL_LIMIT = 3                      # consecutive subreddits with zero progress → end the run early


def mentions_term(text: str | None) -> bool:
    t = (text or "").lower()
    return any(term in t for term in SETTINGS.reddit_terms)


def sub_cursor_key(sub: str) -> str:
    return f"reddit_sub:{sub.lower()}"


def parse_post(p: dict[str, Any]) -> RawItem | None:
    if p.get("author") in SKIP_AUTHORS:
        return None
    body = (p.get("selftext") or "").strip()
    if body in SKIP_BODIES:
        body = ""
    title = (p.get("title") or "").strip()
    if not title and not body:
        return None
    return RawItem(
        source="reddit_post",
        source_id=p["id"],
        title=title or None,
        text=body,  # may be empty for link/title-only posts; title still carries meaning
        posted_at=to_utc(p["created_utc"]),
        url=f"https://www.reddit.com{p['permalink']}" if p.get("permalink") else None,
        author_hash=hash_author(p.get("author")),
        meta={
            "subreddit": p.get("subreddit"),
            "score": p.get("score"),
            "num_comments": p.get("num_comments"),
        },
    )


def parse_comment(c: dict[str, Any], post_title: str | None) -> RawItem | None:
    body = (c.get("body") or "").strip()
    if c.get("author") in SKIP_AUTHORS or body in SKIP_BODIES:
        return None
    link_id = (c.get("link_id") or "").removeprefix("t3_")
    permalink = c.get("permalink") or (
        f"/r/{c.get('subreddit')}/comments/{link_id}/_/{c['id']}/" if link_id else None
    )
    return RawItem(
        source="reddit_comment",
        source_id=c["id"],
        text=body,
        posted_at=to_utc(c["created_utc"]),
        url=f"https://www.reddit.com{permalink}" if permalink else None,
        author_hash=hash_author(c.get("author")),
        meta={
            "subreddit": c.get("subreddit"),
            "score": c.get("score"),
            "post_id": link_id,
            "post_title": post_title,  # context for tagging; the comment alone is often ambiguous
            "is_top_level": (c.get("parent_id") or "").startswith("t3_"),
        },
    )


class RedditCollector:
    name = "reddit"

    def __init__(self, http: HttpClient | None = None):
        # A free volunteer-run service: go slowly and honour its rate-limit resets.
        self.http = http or HttpClient(pause_s=SETTINGS.arctic_pause_s, max_retries=3, first_backoff_s=5.0)
        self.base = SETTINGS.arctic_base_url
        # Counters reported in run stats so gaps and savings are visible.
        self.failed_windows = 0
        self.failed_threads = 0
        self.skipped_threads = 0
        self.reused_threads = 0
        self.stopped_early = False
        # Hooks the runner wires to the store (defaults: nothing stored yet).
        self.known: Callable[[list[tuple[str, str]]], set[tuple[str, str]]] = lambda keys: set()
        self.get_cursor: Callable[[str], datetime | None] = lambda key: None
        # Cursor updates to save *after* the runner has stored every yielded item.
        self.cursor_updates: dict[str, datetime] = {}

    # ---------- low-level paging ----------

    def _paged(self, endpoint: str, params: dict[str, Any], since: datetime,
               until: datetime | None = None, max_retries: int | None = None) -> Iterator[dict[str, Any]]:
        """Ascending-date pagination: move `after` forward to the last item's timestamp.

        Dates are sent as epoch seconds; the API rejects ISO strings with fractional seconds.
        """
        after = since
        seen: set[str] = set()
        while True:
            q = {**params, "after": int(after.timestamp()), "sort": "asc", "limit": PAGE}
            if until:
                q["before"] = int(until.timestamp())
            rows = self.http.get_json(f"{self.base}/{endpoint}", q, max_retries=max_retries).get("data") or []
            fresh = [r for r in rows if r["id"] not in seen]
            if not fresh:
                return
            for r in fresh:
                seen.add(r["id"])
                yield r
            if len(rows) < PAGE:
                return
            after = to_utc(rows[-1]["created_utc"])

    # ---------- post search with adaptive windows ----------

    def search_range(self, sub: str, term: str, start: datetime, end: datetime) -> tuple[list[dict], datetime]:
        """Search [start, end). Returns (posts, frontier): everything before `frontier` was
        searched completely. On overload, a long window is split in half and retried; a
        short one gets the full retry budget, and if that fails the frontier stops there.
        """
        short = end - start <= MIN_WINDOW
        try:
            posts = list(self._paged("posts/search", {"subreddit": sub, "query": term}, start, end,
                                     max_retries=None if short else 1))
            return posts, end
        except PermanentHttpError:
            raise
        except Exception as exc:
            if short:
                self.failed_windows += 1
                log.warning("reddit: r/%s %s→%s failed after retries: %s", sub, start.date(), end.date(), exc)
                return [], start
            mid = start + (end - start) / 2
            log.info("reddit: r/%s %s→%s overloaded, splitting", sub, start.date(), end.date())
            first, f1 = self.search_range(sub, term, start, mid)
            if f1 < mid:
                return first, f1  # stop at the first gap so the frontier stays contiguous
            second, f2 = self.search_range(sub, term, mid, end)
            return first + second, f2

    def comments_for(self, post: dict[str, Any]) -> Iterator[dict[str, Any]]:
        # Start at the post's own timestamp, not 2005: far cheaper for the server to scan.
        start = to_utc(post["created_utc"]) - timedelta(seconds=1)
        yield from self._paged("comments/search", {"link_id": post["id"]}, start)

    # ---------- main entry ----------

    def collect(self, since: datetime, max_items: int | None = None) -> Iterator[RawItem | CursorAdvance]:
        """For each subreddit: resume from its frontier (or `since` if new), find posts,
        fetch comments for on-topic threads, then yield comments followed by the post.
        After each subreddit, a CursorAdvance marks its new frontier.
        """
        now = datetime.now(timezone.utc)
        refresh_cutoff = now - timedelta(days=SETTINGS.reddit_comment_refresh_days)
        n = 0
        stalled = 0
        done_posts: set[str] = set()

        for sub in SETTINGS.subreddits:
            key = sub_cursor_key(sub)
            frontier = self.get_cursor(key)
            start = frontier - SETTINGS.incremental_overlap if frontier else since
            start = min(start, refresh_cutoff)  # recent threads are re-read: comments still growing

            posts: list[dict] = []
            reached = start
            try:
                for term in SETTINGS.reddit_terms:
                    found, reached_term = self.search_range(sub, term, start, now)
                    posts += found
                    reached = reached_term if term == SETTINGS.reddit_terms[0] else min(reached, reached_term)
            except PermanentHttpError as exc:  # e.g. subreddit renamed or banned
                self.failed_windows += 1
                log.warning("reddit: r/%s skipped: %s", sub, exc)

            # A thread whose comments failed must be found again next run: cap the frontier.
            for p in sorted(posts, key=lambda p: p["created_utc"]):
                if p["id"] in done_posts:
                    continue
                items, ok = self._thread_items(p, since, refresh_cutoff)
                if not ok:
                    reached = min(reached, to_utc(p["created_utc"]))
                    continue
                done_posts.add(p["id"])  # only once it succeeded, so a failure is never masked
                yield from items
                n += len(items)

            if reached > start:
                stalled = 0
                if frontier is None or reached > frontier:
                    self.cursor_updates[key] = reached
                    yield CursorAdvance(key, reached)  # runner saves items first, then this
            else:
                stalled += 1
                if stalled >= STALL_LIMIT:
                    self.stopped_early = True
                    log.warning("reddit: %d subreddits in a row made no progress; Arctic Shift looks "
                                "rate-limited. Stopping early, the next run resumes from here.", stalled)
                    return
            if max_items and n >= max_items:
                return

    def _thread_items(self, p: dict[str, Any], since: datetime,
                      refresh_cutoff: datetime) -> tuple[list[RawItem], bool]:
        """Comments (if the thread is about Blinkit) followed by the post. Returns (items, ok)."""
        post = parse_post(p)
        items: list[RawItem] = []
        fetch = mentions_term(p.get("title"))
        if not fetch:
            # Passing-mention threads (e.g. a street-dogs post) cost a request each and
            # yielded ~1 useful comment per 2 threads in testing, so only the post is kept.
            self.skipped_threads += 1
        elif to_utc(p["created_utc"]) < refresh_cutoff and ("reddit_post", p["id"]) in self.known(
                [("reddit_post", p["id"])]):
            # Stored by an earlier run and too old to be gaining comments.
            self.reused_threads += 1
            fetch = False
        if fetch:
            try:
                for c in self.comments_for(p):
                    item = parse_comment(c, p.get("title"))
                    if item:
                        items.append(item)
            except Exception as exc:
                self.failed_threads += 1
                log.warning("reddit: comments failed for post %s: %s", p["id"], exc)
                return [], False
        # The post comes *after* its comments: items are saved in order, so a stored post
        # means its comments were saved too, which makes the "known thread" skip safe.
        # Keep any post inside the analysis window: a subreddit resuming from an older
        # frontier may legitimately find posts older than this run's `since`.
        if post and post.posted_at >= SETTINGS.window_start():
            items.append(post)
        return items, True

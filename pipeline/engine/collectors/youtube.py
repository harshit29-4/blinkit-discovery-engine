"""YouTube comments on videos about Blinkit, via the YouTube Data API v3 (free key, daily quota).

Strategy (mirrors Reddit): search for videos about Blinkit, then read the comments of videos
whose *title* names Blinkit. Videos that only mention Blinkit in the description (sponsor lines
in recipe or haul videos) are skipped: their comments are about the video, not about Blinkit.

Quota (10,000 units/day free): a search page costs 100 units, a page of 100 comment threads costs
1. Each run stops at `youtube_quota_per_run`, leaving room for re-runs from the site's button.
Each search query keeps a cursor (the newest video it has fully processed); recent videos are
searched again for `youtube_comment_refresh_days`, because their comments keep growing.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..config import SETTINGS
from ..models import CursorAdvance, RawItem
from ..util import hash_author, to_utc

log = logging.getLogger("engine.youtube")

API = "https://www.googleapis.com/youtube/v3"
COST = {"search": 100, "commentThreads": 1}


class YouTubeError(Exception):
    """An API error with YouTube's reason code (e.g. commentsDisabled, quotaExceeded)."""

    def __init__(self, status: int, reason: str, message: str = ""):
        super().__init__(f"{status} {reason}: {message[:120]}")
        self.status = status
        self.reason = reason


class YouTubeApi:
    """Minimal client: GET with retries on 5xx; errors carry YouTube's reason code.
    The key travels as a query parameter and is never logged."""

    def __init__(self, key: str, pause_s: float = 0.2):
        self.key = key
        self.pause_s = pause_s
        self.client = httpx.Client(timeout=30, headers={"User-Agent": SETTINGS.user_agent})

    def get(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        delay = 2.0
        for attempt in range(1, 4):
            time.sleep(self.pause_s)
            try:
                r = self.client.get(f"{API}/{endpoint}", params={**params, "key": self.key})
            except httpx.HTTPError as exc:
                if attempt == 3:
                    raise YouTubeError(0, "network", str(exc)) from None
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code >= 500 and attempt < 3:
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code != 200:
                try:
                    err = r.json().get("error", {})
                except ValueError:
                    err = {}
                reason = ((err.get("errors") or [{}])[0].get("reason")) or str(r.status_code)
                raise YouTubeError(r.status_code, reason, err.get("message", ""))
            return r.json()
        raise YouTubeError(0, "retries", endpoint)


def names_blinkit(text: str | None) -> bool:
    t = (text or "").lower()
    return any(term in t for term in SETTINGS.reddit_terms)  # same terms as Reddit: "blinkit"


def query_cursor_key(q: str) -> str:
    return f"youtube_q:{q.lower()}"


def parse_comment(c: dict[str, Any], video: dict[str, Any], top_level: bool, parent: str | None = None) -> RawItem | None:
    s = c.get("snippet") or {}
    text = (s.get("textOriginal") or s.get("textDisplay") or "").strip()
    if len(text) < SETTINGS.youtube_min_chars:
        return None  # "nice video", emoji-only and similar carry no analysable content
    vid = video["id"]
    return RawItem(
        source="youtube_comment",
        source_id=c["id"],
        text=text,
        posted_at=to_utc(s["publishedAt"]),
        url=f"https://www.youtube.com/watch?v={vid}&lc={c['id']}",
        author_hash=hash_author(s.get("authorChannelId", {}).get("value") or s.get("authorDisplayName")),
        meta={
            "video_id": vid,
            "post_title": video["title"],  # context for screening and tagging, as for Reddit comments
            "channel": video.get("channel"),
            "likes": s.get("likeCount"),
            "is_top_level": top_level,
            **({"parent_id": parent} if parent else {}),
        },
    )


class YouTubeCollector:
    name = "youtube"

    def __init__(self, api: Any | None = None):
        if api is None:
            if not SETTINGS.youtube_api_key:
                raise RuntimeError("YOUTUBE_API_KEY is not set")
            api = YouTubeApi(SETTINGS.youtube_api_key)
        self.api = api
        self.units = 0
        # Counters reported in run stats.
        self.skipped_threads = 0    # videos found but not titled about Blinkit
        self.failed_threads = 0     # comment fetches that failed (retried next run)
        self.disabled_comments = 0
        self.stopped_early = False  # quota for this run (or the day) used up
        self.get_cursor: Callable[[str], datetime | None] = lambda key: None
        self.cursor_updates: dict[str, datetime] = {}

    def _call(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        cost = COST[endpoint]
        if self.units + cost > SETTINGS.youtube_quota_per_run:
            raise YouTubeError(0, "runBudget", "per-run quota budget reached")
        self.units += cost
        return self.api.get(endpoint, params)

    def search(self, q: str, after: datetime, order: str = "date") -> list[dict[str, Any]]:
        """Videos for one query published after `after`."""
        videos: list[dict[str, Any]] = []
        token = None
        for _ in range(SETTINGS.youtube_search_pages):
            # First run of a query: the most relevant videos of the whole window (search returns at
            # most a few hundred results, so "newest first" would only reach back a few weeks).
            # Afterwards: newest first, from the query's cursor.
            params = {"part": "snippet", "q": q, "type": "video", "order": order, "maxResults": 50,
                      "regionCode": "IN", "publishedAfter": after.strftime("%Y-%m-%dT%H:%M:%SZ")}
            if token:
                params["pageToken"] = token
            data = self._call("search", params)
            for it in data.get("items", []):
                sn = it.get("snippet") or {}
                vid = (it.get("id") or {}).get("videoId")
                if vid:
                    videos.append({"id": vid, "title": sn.get("title") or "", "description": sn.get("description") or "",
                                   "channel": sn.get("channelTitle"), "published": to_utc(sn["publishedAt"])})
            token = data.get("nextPageToken")
            if not token:
                break
        return videos

    def comments(self, video: dict[str, Any]) -> list[RawItem]:
        items: list[RawItem] = []
        token = None
        while len(items) < SETTINGS.youtube_max_comments_per_video:
            params = {"part": "snippet,replies", "videoId": video["id"], "maxResults": 100,
                      "order": "time", "textFormat": "plainText"}
            if token:
                params["pageToken"] = token
            data = self._call("commentThreads", params)
            for th in data.get("items", []):
                top = (th.get("snippet") or {}).get("topLevelComment")
                if not top:
                    continue
                item = parse_comment(top, video, True)
                if item:
                    items.append(item)
                for rep in (th.get("replies") or {}).get("comments", []):
                    r = parse_comment(rep, video, False, parent=top["id"])
                    if r:
                        items.append(r)
            token = data.get("nextPageToken")
            if not token:
                break
        return items

    def collect(self, since: datetime, max_items: int | None = None) -> Iterator[RawItem | CursorAdvance]:
        now = datetime.now(timezone.utc)
        refresh_cutoff = now - timedelta(days=SETTINGS.youtube_comment_refresh_days)
        done: set[str] = set()
        n = 0
        for q in SETTINGS.youtube_queries:
            key = query_cursor_key(q)
            frontier = self.get_cursor(key)
            start = frontier - SETTINGS.incremental_overlap if frontier else since
            start = max(since, min(start, refresh_cutoff))  # recent videos: re-read their comments
            try:
                videos = self.search(q, start, "date" if frontier else "relevance")
            except YouTubeError as exc:
                self._stop_or_log(exc, f"search '{q}'")
                if self.stopped_early:
                    return
                continue

            ok_through: datetime | None = None
            complete = True
            # Oldest first, so the cursor can advance video by video.
            for v in sorted(videos, key=lambda v: v["published"]):
                if v["id"] in done:
                    continue
                if not names_blinkit(v["title"]):
                    self.skipped_threads += 1
                    done.add(v["id"])
                    continue
                try:
                    items = self.comments(v)
                except YouTubeError as exc:
                    if exc.reason in ("commentsDisabled", "videoNotFound", "forbidden"):
                        self.disabled_comments += 1
                        done.add(v["id"])
                        continue
                    self._stop_or_log(exc, f"comments for {v['id']}")
                    complete = False
                    if self.stopped_early:
                        break
                    continue
                done.add(v["id"])
                yield from items
                n += len(items)
                if complete:
                    ok_through = v["published"]
                if max_items and n >= max_items:
                    complete = False
                    break

            # The cursor only moves over videos whose comments were all stored.
            if ok_through and (frontier is None or ok_through > frontier):
                self.cursor_updates[key] = ok_through
                yield CursorAdvance(key, ok_through)
            if self.stopped_early or (max_items and n >= max_items):
                return

    def _stop_or_log(self, exc: YouTubeError, what: str) -> None:
        if exc.reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "runBudget"):
            self.stopped_early = True
            log.warning("youtube: stopping (%s) at %s; the next run continues", exc.reason, what)
        else:
            self.failed_threads += 1
            log.warning("youtube: %s failed: %s", what, exc)

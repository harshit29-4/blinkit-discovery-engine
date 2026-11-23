"""App Store reviews via Apple's public customer-reviews RSS feed (no key).

The feed only exposes the ~500 most recent reviews (10 pages × 50), so frequent runs
are what build up history over time.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import datetime
from typing import Any

from ..config import SETTINGS
from ..models import RawItem
from ..util import HttpClient, hash_author, to_utc

log = logging.getLogger("engine.app_store")


def _label(entry: dict[str, Any], key: str) -> str | None:
    value = entry.get(key)
    return value.get("label") if isinstance(value, dict) else None


def parse_entry(entry: dict[str, Any]) -> RawItem | None:
    """Returns None for non-review entries (older feeds put app metadata first)."""
    rating = _label(entry, "im:rating")
    review_id = _label(entry, "id")
    if rating is None or review_id is None:
        return None
    author = entry.get("author", {}).get("name", {}).get("label")
    return RawItem(
        source="app_store",
        source_id=review_id,
        title=(_label(entry, "title") or "").strip() or None,
        text=(_label(entry, "content") or "").strip(),
        posted_at=to_utc(_label(entry, "updated") or ""),
        url=f"https://apps.apple.com/{SETTINGS.appstore_country}/app/id{SETTINGS.appstore_app_id}?see-all=reviews",
        rating=int(rating),
        author_hash=hash_author(author),
        lang_hint="en",
        meta={
            "app_version": _label(entry, "im:version"),
            "vote_sum": _label(entry, "im:voteSum"),
            "vote_count": _label(entry, "im:voteCount"),
        },
    )


class AppStoreCollector:
    name = "app_store"

    def __init__(self, http: HttpClient | None = None):
        self.http = http or HttpClient()

    def page_url(self, page: int) -> str:
        return (
            f"https://itunes.apple.com/{SETTINGS.appstore_country}/rss/customerreviews/"
            f"page={page}/id={SETTINGS.appstore_app_id}/sortby=mostrecent/json"
        )

    def collect(self, since: datetime, max_items: int | None = None) -> Iterator[RawItem]:
        n = 0
        for page in range(1, SETTINGS.appstore_max_pages + 1):
            data = self.http.get_json(self.page_url(page))
            entries = data.get("feed", {}).get("entry", [])
            if isinstance(entries, dict):  # a single entry isn't wrapped in a list
                entries = [entries]
            if not entries:
                return
            for entry in entries:
                item = parse_entry(entry)
                if item is None or not item.text:
                    continue
                if item.posted_at < since:
                    log.info("app_store: reached window boundary after %d items", n)
                    return
                yield item
                n += 1
                if max_items and n >= max_items:
                    return

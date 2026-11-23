"""Google Play reviews via the unofficial google-play-scraper library (no key)."""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from datetime import datetime
from typing import Any

from google_play_scraper import Sort, reviews

from ..config import SETTINGS
from ..models import RawItem, ShortReview
from ..util import hash_author, to_utc

log = logging.getLogger("engine.play_store")

BATCH = 200  # library maximum per request


def parse_review(r: dict[str, Any], lang: str) -> RawItem:
    app_id = SETTINGS.play_app_id
    return RawItem(
        source="play_store",
        source_id=r["reviewId"],
        text=(r.get("content") or "").strip(),
        posted_at=to_utc(r["at"]),
        url=f"https://play.google.com/store/apps/details?id={app_id}&reviewId={r['reviewId']}",
        rating=r.get("score"),
        author_hash=hash_author(r.get("userName")),
        lang_hint=lang,
        meta={
            "thumbs_up": r.get("thumbsUpCount"),
            "app_version": r.get("reviewCreatedVersion") or r.get("appVersion"),
            "has_company_reply": bool(r.get("replyContent")),
        },
    )


class PlayStoreCollector:
    name = "play_store"

    def collect(self, since: datetime, max_items: int | None = None) -> Iterator[RawItem | ShortReview]:
        """Newest-first per language, stopping at `since` or `max_items` (per language).
        Reviews under `play_min_chars` come out as rating-only ShortReview rows."""
        for lang in SETTINGS.play_langs:
            yield from self._collect_lang(lang, since, max_items)

    def _collect_lang(self, lang: str, since: datetime, max_items: int | None) -> Iterator[RawItem]:
        token = None
        n = 0
        while True:
            batch, token = reviews(
                SETTINGS.play_app_id,
                lang=lang,
                country=SETTINGS.play_country,
                sort=Sort.NEWEST,
                count=BATCH,
                continuation_token=token,
            )
            if not batch:
                return
            for r in batch:
                item = parse_review(r, lang)
                if item.posted_at < since:
                    log.info("play_store[%s]: reached window boundary after %d items", lang, n)
                    return
                if len(item.text) < SETTINGS.play_min_chars:
                    yield ShortReview(item.source, item.source_id, item.posted_at, item.rating, lang)
                    continue
                yield item
                n += 1  # max_items counts analysable reviews only
                if max_items and n >= max_items:
                    return
            if token is None or getattr(token, "token", None) is None:
                return
            time.sleep(SETTINGS.request_pause_s)

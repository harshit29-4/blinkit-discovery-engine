"""The one shape every collector produces, whatever the source."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class CursorAdvance:
    """Yielded by a collector *after* the items a cursor covers. The runner stores everything
    buffered so far, then saves the cursor, so progress survives a run being killed."""

    key: str
    value: datetime


@dataclass(frozen=True)
class ShortReview:
    """A review too short to analyse ("good", "nice"). Only its rating and day are kept, so
    rating statistics stay complete without storing hundreds of thousands of texts.
    (Decision 2026-11-23: Play Store reviews under 40 characters.)"""

    source: str
    source_id: str
    posted_at: datetime
    rating: int | None
    lang_hint: str | None = None


@dataclass
class RawItem:
    source: str               # play_store | app_store | reddit_post | reddit_comment
    source_id: str            # unique within the source
    text: str                 # main body (title kept separately)
    posted_at: datetime       # always timezone-aware UTC
    url: str | None = None
    title: str | None = None
    rating: int | None = None  # 1–5 stars where the source has them
    author_hash: str | None = None  # never the raw username
    lang_hint: str | None = None    # what the source claims, not detected
    meta: dict[str, Any] = field(default_factory=dict)
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        if self.posted_at.tzinfo is None:
            raise ValueError(f"{self.source}:{self.source_id} posted_at must be timezone-aware")

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["posted_at"] = self.posted_at.astimezone(timezone.utc).isoformat()
        row["fetched_at"] = self.fetched_at.astimezone(timezone.utc).isoformat()
        return row

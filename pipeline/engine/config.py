"""Central settings. Everything tunable lives here, not scattered in collectors."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

PIPELINE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = PIPELINE_DIR.parent
DATA_DIR = PROJECT_DIR / "data"

# .env sits at the project root (gitignored). In GitHub Actions the same names come from secrets.
load_dotenv(PROJECT_DIR / ".env")


def _project_url(value: str | None) -> str | None:
    """'https://x.supabase.co/rest/v1/' → 'https://x.supabase.co'."""
    if not value:
        return None
    url = value.strip().rstrip("/")
    for suffix in ("/rest/v1", "/rest"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
    return url


@dataclass(frozen=True)
class Settings:
    # Rolling analysis window (decision Q8: last 12 months).
    window_days: int = 365

    # Play Store
    play_app_id: str = "com.grofers.customerapp"
    play_country: str = "in"
    play_langs: tuple[str, ...] = ("en", "hi")
    # Reviews shorter than this are stored as rating-only ShortReview rows (decision 2026-11-23).
    # ~2,000 English reviews/day, ~80% under 40 chars, so this cuts storage ~5x.
    play_min_chars: int = 40

    # App Store
    appstore_app_id: str = "960335206"
    appstore_country: str = "in"
    appstore_max_pages: int = 10  # Apple's RSS feed stops at 10 pages × 50 reviews

    # Reddit via Arctic Shift (decision: no official API, no key)
    arctic_base_url: str = "https://arctic-shift.photon-reddit.com/api"
    # Blinkit only (decision Q1). "grofers" (pre-2021 name) was dropped: it doubled the
    # search load for almost no mentions inside a 12-month window.
    reddit_terms: tuple[str, ...] = ("blinkit",)
    arctic_pause_s: float = 2.0
    subreddits: tuple[str, ...] = (
        "bangalore", "mumbai", "delhi", "gurgaon", "noida", "pune", "hyderabad",
        "chennai", "kolkata", "ahmedabad", "india", "indiasocial", "IndianFood",
        "indianpets", "IndianSkincareAddicts", "IndianBeautyDeals",
    )
    # On incremental runs, re-check comments on threads this recent (they keep growing).
    reddit_comment_refresh_days: int = 7

    # YouTube Data API v3 (free key; 10,000 quota units/day; search = 100 units, comment page = 1)
    youtube_queries: tuple[str, ...] = (
        "blinkit", "blinkit review", "blinkit haul", "blinkit order", "blinkit unboxing",
        "blinkit vs zepto", "blinkit experience", "blinkit delivery",
    )
    youtube_search_pages: int = 2           # 50 videos per page
    youtube_max_comments_per_video: int = 200  # spreads coverage over more videos (some Shorts have 400+ off-topic comments)
    youtube_min_chars: int = 30             # shorter comments ("nice video") are not stored
    youtube_comment_refresh_days: int = 14  # recent videos are searched again: comments keep growing
    youtube_quota_per_run: int = 4_000      # leaves room in the day for button-started runs

    # HTTP politeness
    user_agent: str = "blinkit-discovery-engine/0.1 (public research project)"
    request_pause_s: float = 1.0

    # Incremental runs re-read a little overlap so late-indexed items aren't missed.
    incremental_overlap: timedelta = field(default=timedelta(days=2))

    # Secrets (optional until the stage that needs them)
    groq_api_key: str | None = field(default_factory=lambda: os.getenv("GROQ_API_KEY") or None)
    youtube_api_key: str | None = field(default_factory=lambda: os.getenv("YOUTUBE_API_KEY") or None)
    # Normalised to the bare project URL: the dashboard sometimes shows it with "/rest/v1/".
    supabase_url: str | None = field(default_factory=lambda: _project_url(os.getenv("SUPABASE_URL")))
    # New-style secret key (sb_secret_...) preferred; the legacy service_role JWT also works.
    supabase_service_key: str | None = field(
        default_factory=lambda: os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None
    )
    # Postgres connection string (Session pooler), used only to apply migrations.
    supabase_db_url: str | None = field(default_factory=lambda: os.getenv("SUPABASE_DB_URL") or None)

    def window_start(self, now: datetime | None = None) -> datetime:
        now = now or datetime.now(timezone.utc)
        return now - timedelta(days=self.window_days)


SETTINGS = Settings()

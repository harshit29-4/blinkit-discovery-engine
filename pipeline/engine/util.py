"""Small shared helpers: hashing, time parsing, a polite HTTP client."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .config import SETTINGS

log = logging.getLogger("engine")

# Salt so author hashes can't be reversed by hashing a known username list.
# Set AUTHOR_HASH_SALT in .env / secrets; the default only suits local dev.
_SALT = os.getenv("AUTHOR_HASH_SALT", "local-dev-salt")


def hash_author(name: str | None) -> str | None:
    if not name or name in {"[deleted]", "A Google user"}:
        return None
    return hashlib.sha256(f"{_SALT}:{name}".encode()).hexdigest()[:16]


def short_id(source_id: str) -> int:
    """Compact 63-bit key for a review ID: half the storage of the 36-char UUID text, and a
    collision is practically impossible at our scale (~10^6 rows)."""
    return int.from_bytes(hashlib.sha256(source_id.encode()).digest()[:8], "big") >> 1


def to_utc(value: datetime | int | float | str) -> datetime:
    """Accepts naive-local datetimes, epoch seconds, or ISO strings; returns aware UTC."""
    if isinstance(value, datetime):
        # Naive datetimes (e.g. google-play-scraper uses fromtimestamp) are local time.
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class PermanentHttpError(Exception):
    """A 4xx response that retrying can't fix."""


class OverloadedError(RuntimeError):
    """The server asked us to slow down. `reset_s` is its announced wait, if it gave one."""

    def __init__(self, msg: str, reset_s: float | None = None):
        super().__init__(msg)
        self.reset_s = reset_s


MAX_RESET_WAIT_S = 65.0  # never trust a reset header to park us longer than this


class HttpClient:
    """GET with retries, exponential backoff and a fixed pause between calls."""

    def __init__(self, pause_s: float | None = None, max_retries: int = 4, timeout_s: float = 30,
                 first_backoff_s: float = 2.0):
        self.pause_s = SETTINGS.request_pause_s if pause_s is None else pause_s
        self.max_retries = max_retries
        self.first_backoff_s = first_backoff_s
        self._client = httpx.Client(
            timeout=timeout_s,
            headers={"User-Agent": SETTINGS.user_agent},
            follow_redirects=True,
        )

    def get_json(self, url: str, params: dict[str, Any] | None = None, max_retries: int | None = None) -> Any:
        retries = self.max_retries if max_retries is None else max_retries
        delay = self.first_backoff_s
        for attempt in range(1, retries + 1):
            time.sleep(self.pause_s)
            try:
                resp = self._client.get(url, params=params)
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(f"retryable {resp.status_code}", request=resp.request, response=resp)
                if 400 <= resp.status_code < 500:
                    if "timeout" in resp.text.lower() or "slow down" in resp.text.lower():
                        # Arctic Shift signals overload as a 4xx "Timeout. Maybe slow down a bit",
                        # with x-ratelimit-reset = seconds until its rate window resets.
                        reset = resp.headers.get("x-ratelimit-reset")
                        raise OverloadedError(f"server overloaded ({resp.status_code})",
                                              float(reset) if reset and reset.isdigit() else None)
                    # Permanent client error (bad parameters): retrying won't help.
                    raise PermanentHttpError(f"{resp.status_code} for {resp.url}: {resp.text[:200]}")
                resp.raise_for_status()
                data = resp.json()
                # Arctic Shift reports overload as 200 + {"error": "Timeout..."}
                if isinstance(data, dict) and data.get("error") and data.get("data") is None:
                    raise RuntimeError(f"api error: {data['error']}")
                return data
            except (httpx.HTTPError, RuntimeError, ValueError) as exc:
                if attempt == retries:
                    raise
                # Prefer the server's own reset time over guessing with exponential backoff.
                reset = getattr(exc, "reset_s", None)
                wait = min(reset + 1, MAX_RESET_WAIT_S) if reset is not None else delay
                log.warning("GET %s failed (%s), retry %d in %.0fs", url, exc, attempt, wait)
                time.sleep(wait)
                delay *= 2

    def close(self) -> None:
        self._client.close()

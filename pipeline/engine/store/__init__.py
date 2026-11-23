"""Storage backends. `local` (SQLite, for development) and `supabase` (production)."""

from __future__ import annotations

from typing import Protocol

from datetime import datetime

from ..models import RawItem, ShortReview


class Store(Protocol):
    def upsert_raw(self, items: list[RawItem]) -> int:
        """Insert or update items; returns how many were new."""

    def upsert_short(self, items: list[ShortReview]) -> None:
        """Store rating-only rows for reviews too short to analyse."""

    def existing_keys(self, keys: list[tuple[str, str]]) -> set[tuple[str, str]]: ...

    def get_cursor(self, source: str) -> datetime | None: ...

    def set_cursor(self, source: str, newest_seen: datetime) -> None: ...

    def start_run(self, kind: str, trigger: str) -> int: ...

    def finish_run(self, run_id: int, status: str, stats: dict, error: str | None = None) -> None: ...


def get_store(name: str) -> Store:
    if name == "local":
        from .local import LocalStore

        return LocalStore()
    if name == "supabase":
        from .supabase import SupabaseStore

        return SupabaseStore()
    raise ValueError(f"unknown store '{name}' (use local or supabase)")

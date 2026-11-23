"""SQLite store mirroring the Supabase tables, so the pipeline runs with zero accounts."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from ..config import DATA_DIR
from ..models import RawItem, ShortReview
from ..util import short_id, to_utc

SCHEMA = """
create table if not exists raw_items (
  source text not null, source_id text not null, text text not null, title text, url text,
  rating integer, author_hash text, lang_hint text, posted_at text not null,
  fetched_at text not null, meta text not null default '{}', first_seen_at text not null,
  primary key (source, source_id)
);
create table if not exists short_reviews (
  source text not null, id_hash integer not null, posted_day text not null,
  rating integer, lang_hint text, primary key (source, id_hash)
);
create table if not exists source_cursors (source text primary key, newest_seen text not null, updated_at text not null);
create table if not exists pipeline_runs (
  id integer primary key autoincrement, kind text not null, trigger text not null,
  status text not null default 'running', started_at text not null, finished_at text,
  stats text not null default '{}', error text
);
"""

# Mutable fields are refreshed on conflict; first_seen_at is kept from the first insert.
UPSERT = """
insert into raw_items (source, source_id, text, title, url, rating, author_hash, lang_hint,
                       posted_at, fetched_at, meta, first_seen_at)
values (:source, :source_id, :text, :title, :url, :rating, :author_hash, :lang_hint,
        :posted_at, :fetched_at, :meta, :fetched_at)
on conflict (source, source_id) do update set
  text = excluded.text, title = excluded.title, rating = excluded.rating,
  fetched_at = excluded.fetched_at, meta = excluded.meta
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalStore:
    def __init__(self, path: Path | None = None):
        path = path or DATA_DIR / "local.sqlite"
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)

    def existing_keys(self, keys: list[tuple[str, str]]) -> set[tuple[str, str]]:
        existing: set[tuple[str, str]] = set()
        for chunk_start in range(0, len(keys), 400):
            chunk = keys[chunk_start:chunk_start + 400]
            q = " or ".join(["(source = ? and source_id = ?)"] * len(chunk))
            flat = [v for k in chunk for v in k]
            existing.update(self.db.execute(f"select source, source_id from raw_items where {q}", flat).fetchall())
        return existing

    def upsert_raw(self, items: list[RawItem]) -> int:
        if not items:
            return 0
        keys = [(i.source, i.source_id) for i in items]
        existing = self.existing_keys(keys)
        rows = []
        for i in items:
            row = i.to_row()
            row["meta"] = json.dumps(row["meta"], ensure_ascii=False)
            rows.append(row)
        with self.db:
            self.db.executemany(UPSERT, rows)
            # A review edited from short to long moves tables, so ratings are never double-counted.
            self.db.executemany("delete from short_reviews where source = ? and id_hash = ?",
                                [(i.source, short_id(i.source_id)) for i in items])
        return len({k for k in keys if k not in existing})

    def upsert_short(self, items: list[ShortReview]) -> None:
        if not items:
            return
        rows = [(i.source, short_id(i.source_id), i.posted_at.date().isoformat(), i.rating, i.lang_hint)
                for i in items]
        with self.db:
            self.db.executemany(
                "insert into short_reviews values (?, ?, ?, ?, ?) on conflict (source, id_hash) "
                "do update set rating = excluded.rating", rows)
            # A review edited from long to short moves tables, so ratings are never double-counted.
            self.db.executemany("delete from raw_items where source = ? and source_id = ?",
                                [(i.source, i.source_id) for i in items])

    def short_review_daily(self) -> list[tuple]:
        return self.db.execute(
            "select source, posted_day, rating, count(*) from short_reviews group by 1, 2, 3 order by 2"
        ).fetchall()

    def get_cursor(self, source: str) -> datetime | None:
        row = self.db.execute("select newest_seen from source_cursors where source = ?", (source,)).fetchone()
        return to_utc(row[0]) if row else None

    def set_cursor(self, source: str, newest_seen: datetime) -> None:
        with self.db:
            self.db.execute(
                "insert into source_cursors values (?, ?, ?) on conflict (source) do update set "
                "newest_seen = max(newest_seen, excluded.newest_seen), updated_at = excluded.updated_at",
                (source, newest_seen.isoformat(), _now()),
            )

    def start_run(self, kind: str, trigger: str) -> int:
        with self.db:
            cur = self.db.execute(
                "insert into pipeline_runs (kind, trigger, started_at) values (?, ?, ?)", (kind, trigger, _now())
            )
        return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str, stats: dict, error: str | None = None) -> None:
        with self.db:
            self.db.execute(
                "update pipeline_runs set status = ?, finished_at = ?, stats = ?, error = ? where id = ?",
                (status, _now(), json.dumps(stats), error, run_id),
            )

    def source_summary(self) -> list[tuple]:
        return self.db.execute(
            "select source, count(*), min(posted_at), max(posted_at) from raw_items group by source order by source"
        ).fetchall()

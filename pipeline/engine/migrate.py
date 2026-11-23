"""Applies supabase/migrations/*.sql in order, once each, tracked in public.schema_migrations.

Run from pipeline/:  python -m engine migrate          (apply pending)
                     python -m engine migrate --status (list applied / pending)
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .config import PROJECT_DIR, SETTINGS

log = logging.getLogger("engine.migrate")

MIGRATIONS_DIR = PROJECT_DIR / "supabase" / "migrations"

TRACKING = """
create table if not exists public.schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
"""


def pending(applied: set[str], directory: Path = MIGRATIONS_DIR) -> list[Path]:
    return [p for p in sorted(directory.glob("*.sql")) if p.name not in applied]


def _connect():
    import psycopg  # imported lazily: only migrations need a direct DB connection

    if not SETTINGS.supabase_db_url:
        raise SystemExit("SUPABASE_DB_URL is not set in .env (see docs/WALKTHROUGH.md, 'Setting up Supabase').")
    # Deliberately ONE attempt: repeated failed logins trip the pooler's circuit breaker,
    # which then blocks even the correct password for a while (learned the hard way).
    # The URL is split into fields and the password passed *exactly as written in .env*.
    # Handing libpq the whole URL makes it percent-decode the password, so a real password
    # containing e.g. "%4a" silently became a different one and was rejected.
    u = urlsplit(SETTINGS.supabase_db_url)
    try:
        # autocommit: each migration below gets its own real transaction via conn.transaction()
        return psycopg.connect(
            host=u.hostname, port=u.port or 5432, user=unquote(u.username or ""),
            password=u.password or "", dbname=(u.path or "/postgres").lstrip("/") or "postgres",
            connect_timeout=15, autocommit=True,
        )
    except psycopg.OperationalError as exc:
        msg = str(exc)
        if "ECIRCUITBREAKER" in msg:
            raise SystemExit("Supabase's pooler is temporarily blocking logins after too many failed attempts. "
                             "Wait ~10 minutes, then run migrate once.") from None
        if "password authentication failed" in msg:
            raise SystemExit("Database password rejected. If you reset it in the last few minutes, the pooler "
                             "may not have it everywhere yet: wait a few minutes and run migrate ONCE. "
                             "Otherwise re-check the password in SUPABASE_DB_URL.") from None
        raise


def run(status_only: bool = False) -> int:
    with _connect() as conn:
        conn.execute(TRACKING)
        applied = {r[0] for r in conn.execute("select name from public.schema_migrations")}
        todo = pending(applied)
        for name in sorted(applied):
            print(f"  applied  {name}")
        for path in todo:
            print(f"  pending  {path.name}")
        if status_only or not todo:
            print("Nothing to apply." if not todo else "")
            return 0
        for path in todo:
            # Each file in its own transaction: a failure leaves earlier ones applied, this one not.
            with conn.transaction():
                conn.execute(path.read_text(encoding="utf-8"))
                conn.execute("insert into public.schema_migrations (name) values (%s)", (path.name,))
            print(f"  ✓ applied {path.name}")
        # Ask PostgREST to pick up the new tables/views straight away.
        conn.execute("notify pgrst, 'reload schema'")
    return 0

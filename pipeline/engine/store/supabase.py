"""Supabase store over the PostgREST API (service key; runs only in the pipeline, never the browser)."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ..config import SETTINGS
from ..models import RawItem, ShortReview
from ..util import short_id, to_utc

BATCH = 500


def check() -> int:
    """Verifies the Supabase setup without printing any secret. Returns a process exit code."""
    import os

    ok = True

    def report(label: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= passed
        print(f"  {'✓' if passed else '✗'} {label}{(' - ' + detail) if detail else ''}")

    url = SETTINGS.supabase_url
    report("SUPABASE_URL set", bool(url), "" if url else "add it to .env")
    report("SUPABASE_SECRET_KEY set", bool(SETTINGS.supabase_service_key))
    publishable = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    report("SUPABASE_PUBLISHABLE_KEY set", bool(publishable))
    if not (url and SETTINGS.supabase_service_key):
        return 1
    base = f"{url.rstrip('/')}/rest/v1"
    with httpx.Client(timeout=20) as http:
        # A key check that doesn't depend on any table existing: the API root.
        r = http.get(f"{base}/", headers=auth_headers(SETTINGS.supabase_service_key))
        report("secret key accepted", r.status_code == 200, "" if r.status_code == 200 else f"HTTP {r.status_code}: {r.text[:150]}")
        r = http.get(f"{base}/raw_items", params={"select": "source", "limit": 1},
                     headers=auth_headers(SETTINGS.supabase_service_key))
        report("secret key can read raw_items", r.status_code == 200,
               "" if r.status_code == 200 else f"HTTP {r.status_code}: {r.text[:150]} (run `migrate` first?)")
        if publishable:
            h = auth_headers(publishable)
            r = http.get(f"{base}/v_source_counts", params={"select": "*"}, headers=h)
            report("publishable key can read the public view", r.status_code == 200,
                   "" if r.status_code == 200 else f"HTTP {r.status_code}: {r.text[:150]}")
            r = http.get(f"{base}/raw_items", params={"select": "text", "limit": 1}, headers=h)
            hidden = r.status_code in (401, 403) or (r.status_code == 200 and r.json() == [])
            report("publishable key can NOT read raw review rows (RLS)", hidden, f"HTTP {r.status_code}")
    print("All good." if ok else "Some checks failed.")
    return 0 if ok else 1


def auth_headers(key: str) -> dict[str, str]:
    """New `sb_secret_...` keys go in the `apikey` header only (they aren't JWTs).
    Legacy service_role keys are JWTs and are also sent as a Bearer token."""
    headers = {"apikey": key, "Content-Type": "application/json"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


class SupabaseStore:
    def __init__(self) -> None:
        if not (SETTINGS.supabase_url and SETTINGS.supabase_service_key):
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example)")
        self.http = httpx.Client(
            base_url=f"{SETTINGS.supabase_url.rstrip('/')}/rest/v1",
            headers=auth_headers(SETTINGS.supabase_service_key),
            timeout=60,
        )

    def upsert_raw(self, items: list[RawItem]) -> int:
        new = 0
        for start in range(0, len(items), BATCH):
            chunk = items[start:start + BATCH]
            rows = [{k: v for k, v in i.to_row().items()} for i in chunk]
            # Count which keys already exist, so we can report "new" vs "updated".
            existing = self.existing_keys([(i.source, i.source_id) for i in chunk])
            resp = self.http.post(
                "/raw_items",
                params={"on_conflict": "source,source_id"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=rows,
            )
            resp.raise_for_status()
            new += sum(1 for i in chunk if (i.source, i.source_id) not in existing)
            # A review edited from short to long moves tables, so ratings are never double-counted.
            play = [str(short_id(i.source_id)) for i in chunk if i.source == "play_store"]
            self._delete_in("/short_reviews", "play_store", "id_hash", play)
        return new

    def upsert_short(self, items: list[ShortReview]) -> None:
        for start in range(0, len(items), BATCH):
            chunk = items[start:start + BATCH]
            rows = [{"source": i.source, "id_hash": short_id(i.source_id),
                     "posted_day": i.posted_at.date().isoformat(), "rating": i.rating, "lang_hint": i.lang_hint}
                    for i in chunk]
            resp = self.http.post(
                "/short_reviews",
                params={"on_conflict": "source,id_hash"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=rows,
            )
            resp.raise_for_status()
            self._delete_in("/raw_items", chunk[0].source, "source_id",
                            [f'"{i.source_id}"' for i in chunk if i.source == chunk[0].source])

    def _delete_in(self, table: str, source: str, column: str, values: list[str]) -> None:
        for start in range(0, len(values), 150):  # keep the URL well under server limits
            part = values[start:start + 150]
            resp = self.http.delete(table, params={"source": f"eq.{source}", column: f"in.({','.join(part)})"})
            resp.raise_for_status()

    def existing_keys(self, keys: list[tuple[str, str]]) -> set[tuple[str, str]]:
        by_source: dict[str, list[str]] = {}
        for source, source_id in keys:
            by_source.setdefault(source, []).append(source_id)
        found: set[tuple[str, str]] = set()
        for source, ids in by_source.items():
            quoted = ",".join(f'"{x}"' for x in ids)
            resp = self.http.get(
                "/raw_items",
                params={"select": "source,source_id", "source": f"eq.{source}", "source_id": f"in.({quoted})"},
            )
            resp.raise_for_status()
            found.update((r["source"], r["source_id"]) for r in resp.json())
        return found

    def get_cursor(self, source: str) -> datetime | None:
        resp = self.http.get("/source_cursors", params={"select": "newest_seen", "source": f"eq.{source}"})
        resp.raise_for_status()
        rows = resp.json()
        return to_utc(rows[0]["newest_seen"]) if rows else None

    def set_cursor(self, source: str, newest_seen: datetime) -> None:
        current = self.get_cursor(source)
        if current and current >= newest_seen:
            return
        resp = self.http.post(
            "/source_cursors",
            params={"on_conflict": "source"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json={"source": source, "newest_seen": newest_seen.isoformat(),
                  "updated_at": datetime.now(timezone.utc).isoformat()},
        )
        resp.raise_for_status()

    def start_run(self, kind: str, trigger: str) -> int:
        resp = self.http.post(
            "/pipeline_runs", headers={"Prefer": "return=representation"}, json={"kind": kind, "trigger": trigger}
        )
        resp.raise_for_status()
        return int(resp.json()[0]["id"])

    def finish_run(self, run_id: int, status: str, stats: dict, error: str | None = None) -> None:
        resp = self.http.patch(
            "/pipeline_runs",
            params={"id": f"eq.{run_id}"},
            json={"status": status, "stats": stats, "error": error,
                  "finished_at": datetime.now(timezone.utc).isoformat()},
        )
        resp.raise_for_status()

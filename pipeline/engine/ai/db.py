"""Supabase access for the AI stages (PostgREST + RPC queues), with the service key."""

from __future__ import annotations

import json
from typing import Any

import httpx

from ..config import SETTINGS
from ..store.supabase import auth_headers

BATCH = 500


class AIStore:
    def __init__(self, http: httpx.Client | None = None) -> None:
        if http is None:
            if not (SETTINGS.supabase_url and SETTINGS.supabase_service_key):
                raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
            http = httpx.Client(base_url=f"{SETTINGS.supabase_url}/rest/v1",
                                headers=auth_headers(SETTINGS.supabase_service_key), timeout=60)
        self.http = http

    def rpc(self, fn: str, **params: Any) -> list[dict]:
        r = self.http.post(f"/rpc/{fn}", json=params)
        r.raise_for_status()
        return r.json() if r.content else []

    def upsert(self, table: str, rows: list[dict], on_conflict: str = "source,source_id") -> None:
        for i in range(0, len(rows), BATCH):
            r = self.http.post(f"/{table}", params={"on_conflict": on_conflict},
                               headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                               json=rows[i:i + BATCH])
            r.raise_for_status()

    def mark_failed(self, keys: list[tuple[str, str]], err: str) -> None:
        if keys:
            self.rpc("ai_mark_failed", keys=[{"source": s, "source_id": i} for s, i in keys], err=err[:300])

    def log_call(self, **row: Any) -> None:
        r = self.http.post("/ai_calls", headers={"Prefer": "return=minimal"}, json=row)
        r.raise_for_status()

    # Queues
    def queue_screen(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_screen", n=n)

    def queue_relevance(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_relevance", n=n)

    def queue_tagging(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_tagging", n=n)

    def queue_translation_check(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_translation_check", n=n)

    # Run log (same table as collection runs)
    def start_run(self, trigger: str) -> int:
        r = self.http.post("/pipeline_runs", headers={"Prefer": "return=representation"},
                           json={"kind": "analyse", "trigger": trigger})
        r.raise_for_status()
        return int(r.json()[0]["id"])

    def finish_run(self, run_id: int, status: str, stats: dict, error: str | None = None) -> None:
        from datetime import datetime, timezone

        r = self.http.patch("/pipeline_runs", params={"id": f"eq.{run_id}"},
                            json={"status": status, "stats": json.loads(json.dumps(stats, default=str)),
                                  "error": error, "finished_at": datetime.now(timezone.utc).isoformat()})
        r.raise_for_status()

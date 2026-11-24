"""Supabase access for the AI stages (PostgREST + RPC queues), with the service key."""

from __future__ import annotations

import json
from typing import Any

import httpx

from ..config import SETTINGS
from ..store.supabase import auth_headers

BATCH = 500


# Sources where people discuss Blinkit (vs. app-store reviews); they share up to 40% of every
# relevance and tagging batch, so they are not drowned by ~100k Play Store reviews.
DISCUSSION_SOURCES = ["reddit_post", "reddit_comment", "youtube_comment"]

class _RetryingClient(httpx.Client):
    """Retries a request once when the server dropped an idle keep-alive connection. That happens
    when one stage leaves the connection idle for minutes while other lanes run."""

    def request(self, *args, **kwargs):
        try:
            return super().request(*args, **kwargs)
        except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError):
            return super().request(*args, **kwargs)


class AIStore:
    def __init__(self, http: httpx.Client | None = None) -> None:
        if http is None:
            if not (SETTINGS.supabase_url and SETTINGS.supabase_service_key):
                raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
            http = _RetryingClient(base_url=f"{SETTINGS.supabase_url}/rest/v1",
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
    def queue_screen(self, after: list | None, n: int) -> list[dict]:
        """Rows added after the bookmark [first_seen_at, source, source_id], in insertion order."""
        ts, src, sid = after or ["-infinity", "", ""]
        return self.rpc("ai_queue_screen", after_ts=ts, after_source=src, after_id=sid, n=n)

    def get_state(self, key: str):
        r = self.http.get("/ai_state", params={"select": "value", "key": f"eq.{key}"})
        r.raise_for_status()
        rows = r.json()
        return rows[0]["value"] if rows else None

    def set_state(self, key: str, value) -> None:
        from datetime import datetime, timezone

        self.upsert("ai_state", [{"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}],
                    on_conflict="key")

    def queue_relevance(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_relevance", n=n, discussion_share=0.4, discussion_sources=DISCUSSION_SOURCES)

    def queue_tagging(self, n: int) -> list[dict]:
        from .prompts import PROMPT_VERSION

        # Up to 40% of each batch from discussion sources (Reddit), so they are not drowned by reviews.
        return self.rpc("ai_queue_tagging", n=n, version=PROMPT_VERSION, discussion_share=0.4,
                        discussion_sources=DISCUSSION_SOURCES)

    def usage_24h(self) -> dict[str, int]:
        """Tokens per model over the last 24 hours (pipeline and chat), for the daily caps."""
        return {r["model"]: int(r["tokens"]) for r in self.rpc("ai_usage_24h")}

    def queue_translation_check(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_translation_check", n=n)

    # ---- phase B queues and loaders

    def queue_embedding(self, n: int) -> list[dict]:
        return self.rpc("ai_queue_embedding", n=n)

    def queue_crosscheck(self, n: int) -> list[dict]:
        from .prompts import PROMPT_VERSION
        from .validation import CROSS_VERSION

        return self.rpc("ai_queue_crosscheck", n=n, tag_version=PROMPT_VERSION, cross_version=CROSS_VERSION)

    def queue_stability(self, n: int, week: str) -> list[dict]:
        return self.rpc("ai_queue_stability", n=n, week=week)

    def get_all(self, path: str, params: dict[str, str], page: int = 1000) -> list[dict]:
        """Reads every row of a table/view in pages (PostgREST caps a response at 1,000 rows)."""
        out, offset = [], 0
        while True:
            r = self.http.get(path, params={**params, "limit": page, "offset": offset})
            r.raise_for_status()
            rows = r.json()
            out += rows
            if len(rows) < page:
                return out
            offset += page

    def load_embeddings(self):
        import numpy as np

        keys, vecs, after = [], [], None
        while True:
            rows = self.rpc("ai_embeddings_page", after_key=after, n=1000)
            if not rows:
                break
            for r in rows:
                keys.append((r["source"], r["source_id"]))
                vecs.append(json.loads(r["embedding"]))
            after = rows[-1]["k"]
        return keys, np.array(vecs, dtype=np.float32).reshape(len(vecs), -1)

    def load_theme_inputs(self) -> dict[tuple[str, str], dict]:
        rows = self.get_all("/item_tags", {
            "select": "source,source_id,sentiment,categories,barriers,evidence_span,evidence_grounded,"
                      "raw_items(rating,posted_at,text)",
            "order": "source,source_id"})
        out = {}
        for r in rows:
            raw = r.pop("raw_items") or {}
            out[(r["source"], r["source_id"])] = {**r, **raw}
        return out

    def save_theme_snapshot(self, *, items: int, noise: int, params: dict, model: str,
                            themes: list[dict], members: list[dict]) -> int:
        r = self.http.post("/theme_snapshots", headers={"Prefer": "return=representation"},
                           json={"items": items, "noise": noise, "params": params, "model": model})
        r.raise_for_status()
        sid = int(r.json()[0]["id"])
        for path, rows in (("/themes", themes), ("/theme_items", members)):
            for i in range(0, len(rows), BATCH):
                resp = self.http.post(path, headers={"Prefer": "return=minimal"},
                                      json=[{**x, "snapshot_id": sid} for x in rows[i:i + BATCH]])
                resp.raise_for_status()
        # Publish only once every row is written, so the site never shows a half-written snapshot.
        self.http.patch("/theme_snapshots", params={"id": f"eq.{sid}"}, json={"published": True}).raise_for_status()
        return sid

    def load_tags_for_validation(self) -> dict[tuple[str, str], dict]:
        rows = self.get_all("/item_tags", {
            "select": "source,source_id,prompt_version,sentiment,categories,category_behavior,barriers,funnel_stage,"
                      "evidence_grounded,translation_score,translation_ok,raw,raw_items(rating)",
            "order": "source,source_id"})
        out = {}
        for r in rows:
            raw = r.pop("raw_items") or {}
            out[(r["source"], r["source_id"])] = {**r, "rating": raw.get("rating")}
        return out

    def load_table_by_key(self, table: str, latest_week: bool = False) -> dict[tuple[str, str], dict]:
        params = {"select": "*", "order": "source,source_id"}
        if latest_week:
            r = self.http.get(f"/{table}", params={"select": "run_week", "order": "run_week.desc", "limit": 1})
            r.raise_for_status()
            if not r.json():
                return {}
            params["run_week"] = f"eq.{r.json()[0]['run_week']}"
        return {(x["source"], x["source_id"]): x for x in self.get_all(f"/{table}", params)}

    def load_funnel(self) -> dict | None:
        r = self.http.get("/v_ai_funnel", params={"select": "*"})
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None

    def insert_metrics(self, rows: list[dict]) -> None:
        if rows:
            self.http.post("/validation_metrics", headers={"Prefer": "return=minimal"}, json=rows).raise_for_status()

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

"""Command line entry point.

Examples (run from the pipeline/ folder):
    python -m engine collect --source all --mode incremental
    python -m engine collect --source reddit --mode backfill --max 200 --store local
    python -m engine summary --store local
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from .collect import run_collect
from .collectors import COLLECTORS
from .store import get_store


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="engine")
    sub = parser.add_subparsers(dest="command", required=True)

    c = sub.add_parser("collect", help="fetch new items from the sources")
    c.add_argument("--source", default="all", choices=["all", *COLLECTORS])
    c.add_argument("--mode", default="incremental", choices=["incremental", "backfill"])
    c.add_argument("--max", type=int, default=None, help="cap items per source (per language for Play)")
    c.add_argument("--store", default="local", choices=["local", "supabase"])
    c.add_argument("--trigger", default="manual", choices=["schedule", "manual", "button"])

    s = sub.add_parser("summary", help="item counts per source")
    s.add_argument("--store", default="local", choices=["local"])

    m = sub.add_parser("migrate", help="apply pending Supabase migrations")
    m.add_argument("--status", action="store_true", help="only list applied/pending")

    sub.add_parser("check-supabase", help="verify Supabase keys and tables work")

    a = sub.add_parser("analyse", help="run AI stages (see --stages)")
    a.add_argument("--stages", default="screen,relevance,tag,translation",
                   help="comma-separated subset of: screen,relevance,tag,translation,embed,crosscheck,stability,themes,metrics")
    a.add_argument("--minutes", type=float, default=45, help="time budget for the whole run")
    a.add_argument("--trigger", default="manual", choices=["schedule", "manual", "button"])

    args = parser.parse_args(argv)
    # Windows consoles default to cp1252, which can't print ✓/→ or Hindi review text.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.command == "collect":
        sources = list(COLLECTORS) if args.source == "all" else [args.source]
        result = run_collect(get_store(args.store), sources, args.mode, args.max, args.trigger)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] != "failed" else 1

    if args.command == "migrate":
        from .migrate import run

        return run(status_only=args.status)

    if args.command == "analyse":
        from .ai.db import AIStore
        from .ai.groq import GroqClient
        from .ai.stages import STAGES, run_phase_a
        from .config import SETTINGS

        stages = [s.strip() for s in args.stages.split(",") if s.strip()]
        unknown = [s for s in stages if s not in STAGES]
        if unknown:
            parser.error(f"unknown stage(s): {', '.join(unknown)}")
        store = AIStore()
        groq = None
        if SETTINGS.groq_api_key:
            from .ai.groq import DAILY_CAPS, TPM_RESERVE

            used = store.usage_24h()
            groq = GroqClient(SETTINGS.groq_api_key, log_call=store.log_call, caps=dict(DAILY_CAPS), used=used,
                              tpm_reserve=dict(TPM_RESERVE))
            print("  tokens used in the last 24 h: " +
                  ", ".join(f"{m.split('/')[-1]} {used.get(m, 0):,}/{c:,}" for m, c in DAILY_CAPS.items()))
        run_id = store.start_run(args.trigger)
        results = run_phase_a(store, groq, stages, args.minutes)
        errors = [s for s, r in results.items() if isinstance(r, dict) and r.get("error")]
        status = "ok" if not errors else ("failed" if len(errors) == len(stages) else "partial")
        store.finish_run(run_id, status, {"mode": "analyse", "stages": results})
        print(json.dumps({"run_id": run_id, "status": status, "stages": results}, indent=2, default=str))
        return 0 if status != "failed" else 1

    if args.command == "check-supabase":
        from .store.supabase import check

        return check()

    if args.command == "summary":
        for source, n, oldest, newest in get_store("local").source_summary():
            print(f"{source:16} {n:7}  {oldest[:10]} → {newest[:10]}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())

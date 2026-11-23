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

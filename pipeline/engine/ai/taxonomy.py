"""Tag vocabulary, shared with the website via web/lib/taxonomy.json (single source of truth)."""

from __future__ import annotations

import json
from functools import lru_cache

from ..config import PROJECT_DIR

TAXONOMY_PATH = PROJECT_DIR / "web" / "lib" / "taxonomy.json"

# Fields holding one value vs. a list of values.
SINGLE = ("sentiment", "category_behavior", "funnel_stage")
MULTI = ("categories", "barriers", "discovery_channels", "info_needs", "segment_signals")


@lru_cache(maxsize=1)
def taxonomy() -> dict[str, dict[str, str]]:
    data = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def allowed(field: str) -> set[str]:
    return set(taxonomy()[field])

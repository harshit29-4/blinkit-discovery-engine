"""Deterministic checks on model output (validation V3 grounding and V4 schema conformance)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .taxonomy import MULTI, SINGLE, allowed

_WS = re.compile(r"\s+")
# Quotes/apostrophes/dashes vary between what the model copies and the source text.
_FOLD = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def _norm(s: str) -> str:
    return _WS.sub(" ", (s or "").translate(_FOLD)).strip().lower()


def is_grounded(span: str | None, *sources: str | None) -> bool:
    """True if `span` appears verbatim (ignoring case, whitespace runs and curly quotes) in a source text.
    Very short spans are rejected: they can't evidence anything."""
    n = _norm(span or "")
    if len(n) < 12:
        return False
    return any(n in _norm(s or "") for s in sources)


@dataclass
class Cleaned:
    tags: dict[str, Any]
    dropped: list[str] = field(default_factory=list)  # values outside the taxonomy, for V4 stats


def clean_tags(obj: dict[str, Any]) -> Cleaned:
    """Coerces a model's tag object into the schema: unknown values dropped, single/list shapes fixed."""
    out: dict[str, Any] = {}
    dropped: list[str] = []
    for f in SINGLE:
        v = obj.get(f)
        if isinstance(v, list):
            v = v[0] if v else None
        if v in allowed(f):
            out[f] = v
        else:
            out[f] = "none" if f in ("category_behavior", "funnel_stage") else None
            if v not in (None, "", "none"):
                dropped.append(f"{f}={v}")
    for f in MULTI:
        v = obj.get(f) or []
        if isinstance(v, str):
            v = [v]
        keep = []
        for x in v:
            if x in allowed(f):
                if x not in keep:
                    keep.append(x)
            elif x not in (None, "", "none"):
                dropped.append(f"{f}={x}")
        out[f] = keep
    out["habit_signal"] = bool(obj.get("habit_signal")) if obj.get("habit_signal") is not None else None
    un = obj.get("unmet_need")
    out["unmet_need"] = str(un).strip()[:200] if un not in (None, "", "null", "none") else None
    out["evidence_span"] = (obj.get("evidence_span") or "").strip()[:600] or None
    tr = obj.get("english_translation")
    out["translation"] = str(tr).strip()[:2000] if tr not in (None, "", "null") else None
    try:
        c = float(obj.get("confidence"))
        out["confidence"] = min(max(c, 0.0), 1.0)
    except (TypeError, ValueError):
        out["confidence"] = None
    return Cleaned(out, dropped)

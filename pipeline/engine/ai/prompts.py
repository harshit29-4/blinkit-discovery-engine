"""Prompts and the models that run them. Bump PROMPT_VERSION whenever a prompt or the taxonomy
changes; tags are stored with the version that produced them."""

from __future__ import annotations

import json

from .taxonomy import taxonomy

PROMPT_VERSION = "tag-v3"        # v3: shared field definitions with the cross-check, shorter outputs
                                 # (v2: funnel_stage only when described; v1 guessed it)
RELEVANCE_VERSION = "rel-v2"     # v2: product return/exchange policy counts as relevant (v1 excluded it)

# Per-stage models: different families for producing vs. checking (see validation V1/V5/V8).
# Groq's free tier caps qwen at 1,000 *output* tokens/minute (not shown in headers; found from a 429
# "Request too large ... OTPM"). Tagging writes ~175 output tokens per entry, so qwen could manage
# only ~300 entries/hour. gpt-oss-120b tags ~1,400/hour within 8k TPM, so it produces the tags and
# qwen, whose checks output only a short score per entry, does the checking.
MODEL_RELEVANCE = "openai/gpt-oss-20b"
MODEL_TAGGING = "openai/gpt-oss-120b"
MODEL_CHECK = "qwen/qwen3.8-27b"

RELEVANCE_SYSTEM = """You screen customer feedback about Blinkit, an Indian quick-commerce app, for a study of why
shoppers keep buying the same product categories and what stops them trying new ones.

Mark an entry RELEVANT if it says anything about:
- which products or categories the person buys, avoids, or would like to buy
- trying, discovering or searching for products or categories (or not knowing they exist)
- trust in product quality, freshness, authenticity or expiry
- habits: reordering the same items, routines, defaults
- information they need before buying (reviews, ingredients, size, return policy)
- range, brands, stock availability or prices of products
- returning or exchanging products, or the return policy (this is part of the risk of trying something new)

Mark it NOT RELEVANT if it is only about delivery speed or delays, delivery staff, app bugs, payments, login,
refund money that is delayed, customer support with no product content, or generic praise or abuse
("good app", "worst service").

Entries may be in English, Hindi or Hinglish. Judge the meaning, not the language.
Return JSON: {"items": [{"id": "<id>", "relevant": true|false, "reason": "<max 5 words>"}]} with one object per entry."""


def core_field_rules() -> str:
    """Definitions shared *verbatim* by the tagger and the cross-checker, so that V1 measures
    disagreement between models rather than between two differently worded instructions."""
    v = {k: list(x) for k, x in taxonomy().items()}
    return f"""- "sentiment": one of {v['sentiment']}
- "categories": list from {v['categories']} (product categories mentioned; [] if none)
- "category_behavior": one of {v['category_behavior']}: "repeat" = says they keep buying the same items or
  categories; "explored" = says they bought from a category new to them; "tried_then_abandoned" = tried a
  product or category and stopped; "wants_but_hesitant" = interested in something but holding back;
  "none" = none of these is described (most complaints about a single order are "none")
- "barriers": list from {v['barriers']} (only barriers the person actually expresses; [] if none)
- "funnel_stage": one of {v['funnel_stage']}: the furthest stage the person explicitly describes for a
  product or category: "awareness" = learning it exists, "consideration" = thinking about buying,
  "trust" = deciding whether it is reliable, "trial" = a first purchase of something new to them,
  "repeat" = buying the same thing again. Use "none" unless the text describes such a stage; a complaint
  about one order, or general praise like "good products", is "none\""""


def tagging_system() -> str:
    v = {k: list(x) for k, x in taxonomy().items()}
    return f"""You annotate customer feedback about Blinkit (Indian quick-commerce) for a research study on
category exploration: why shoppers repeat the same categories and what stops them trying new ones.

For each entry return one JSON object with exactly these fields, using ONLY the listed values:
- "id": the entry id
{core_field_rules()}
- "discovery_channels": list from {v['discovery_channels']} (how they found products; [] if not stated)
- "habit_signal": true if they describe routine or repeat buying, else false
- "info_needs": list from {v['info_needs']} (information they want before buying; [] if none)
- "segment_signals": list from {v['segment_signals']} (ONLY if the text states it; never guess)
- "unmet_need": the need they express that is not met, max 12 words, or null
- "evidence_span": an EXACT, character-for-character excerpt copied from the entry text that best supports
  the tags (5-25 words). Copy it; do not paraphrase, translate or fix spelling.
- "english_translation": faithful English translation if the entry is Hindi or Hinglish, else null

Rules: tag only what is stated, not what is likely. Empty lists are fine. Comments may include the title of
the thread they reply to as context; tag the comment itself.
Return compact JSON: {{"items": [ ... one object per entry ... ]}}"""


TRANSLATION_CHECK_SYSTEM = """You check translations of Hindi/Hinglish customer feedback into English.
For each pair, score how faithfully the English keeps the meaning of the original: 1.0 = same meaning,
0.7 = minor nuance lost, 0.4 = important meaning changed, 0.0 = wrong. Ignore grammar and style.
Return JSON: {"items": [{"id": "<id>", "score": 0.0-1.0, "issue": "<max 10 words or empty>"}]}"""


def entries_payload(rows: list[dict], with_context: bool = True) -> str:
    """Compact JSON list of entries with short numeric ids (saves tokens)."""
    out = []
    for i, r in enumerate(rows, 1):
        e: dict = {"id": str(i)}
        if with_context and r.get("post_title"):
            e["thread_title"] = r["post_title"]
        if r.get("title"):
            e["title"] = r["title"]
        e["text"] = r.get("text") or ""
        out.append(e)
    return json.dumps(out, ensure_ascii=False)

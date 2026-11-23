"""S1 pre-filter: deterministic and free (no AI). Decides which entries the AI reads.

- Detects language (English / Hindi / Hinglish).
- Screens for words about categories, discovery, trust, habit and information needs
  (English and romanised Hindi). Matches become "candidates" for the AI relevance gate.
- Puts a reproducible 5% of non-matching entries into a "control" sample that also goes to
  the AI gate, so we can measure how much relevant feedback the keywords miss (check V6).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

CONTROL_EVERY = 20  # 1 in 20 = 5%

KEYWORDS: dict[str, str] = {
    # Words like "phone", "review" or a bare "tried" were left out on purpose: in app reviews they
    # mostly mean "I tried calling support", which would flood the AI gate with irrelevant entries.
    "category": r"pets?|dogs?|cat food|baby|babies|diapers?|nappy|skin ?care|beauty|cosmetics?|make ?up|lipstick|perfume"
                r"|personal care|shampoo|electronics?|chargers?|earphones?|pharmacy|medicines?|toys?|gifts?|stationery"
                r"|kitchen|utensils?|home decor|organic|protein|categor(y|ies)|new products?",
    "discovery": r"explore|discover|found out|came to know|didn.?t know|did not know|never knew|first time"
                 r"|tried (it|this|the|a|new|out|their)|try (new|something|different)|never (bought|ordered|tried)"
                 r"|new (brand|item|thing)s?|recommend|suggest|banners?|search(ed|ing)? (for|results?)|browse|browsing"
                 r"|pehli baar|pata (hi )?nahi|pata nhi",
    "trust": r"fake|original|genuine|authentic|duplicate|expired?|expiry|quality|stale|rotten|spoil(t|ed)?|sealed"
             r"|tampered|nakli|asli|kharab|purana|sadi?",
    "habit": r"always order|every ?day|daily|weekly|same (items|things|stuff)|re-?order|order again|buy again"
             r"|usual|regular(ly)?|routine|monthly|roz|hamesha|har (din|baar)",
    "info": r"ingredients?|expiry date|mfg date|manufactur|product (details|description|info)|specifications?"
            r"|quantity|weight|return policy|exchange|warranty|price (difference|comparison)|mrp",
}
_COMPILED = {k: re.compile(rf"\b(?:{v})", re.IGNORECASE) for k, v in KEYWORDS.items()}

# Common romanised-Hindi function words. Deliberately excludes ones that are also English ("to", "he").
_HINGLISH = set("""hai hain nahi nhi nahin kya kyu kyun bhi aur mein ka ki ke ko se tha thi raha rahe rahi kar karo
karna kuch bahut bohot accha acha achha bhai yaar wala wali hota hoti diya liya mila mile sab ek jo toh bhot
mera meri mujhe humne maine apne apna liye gaya gayi aata aati pe par kabhi abhi phir lekin magar sirf""".split())
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_WORD = re.compile(r"[a-zA-Z]+")


@dataclass(frozen=True)
class Screen:
    lang: str
    hits: tuple[str, ...]
    pool: str  # candidate | control | excluded


def detect_lang(text: str) -> str:
    if not text:
        return "en"
    if len(_DEVANAGARI.findall(text)) >= max(3, 0.2 * len(text.replace(" ", ""))):
        return "hi"
    words = [w.lower() for w in _WORD.findall(text)]
    if not words:
        return "en"
    hinglish = sum(w in _HINGLISH for w in words)
    return "hinglish" if hinglish >= 2 and hinglish / len(words) >= 0.15 else "en"


def keyword_hits(text: str) -> tuple[str, ...]:
    return tuple(k for k, rx in _COMPILED.items() if rx.search(text or ""))


def in_control_sample(source: str, source_id: str) -> bool:
    h = int(hashlib.sha1(f"{source}:{source_id}".encode()).hexdigest()[:8], 16)
    return h % CONTROL_EVERY == 0


def screen(source: str, source_id: str, title: str | None, text: str, post_title: str | None = None) -> Screen:
    full = " ".join(x for x in (post_title, title, text) if x)
    lang = detect_lang(" ".join(x for x in (title, text) if x))
    # Devanagari text can't be keyword-screened in English, so all of it goes to the AI gate.
    hits = keyword_hits(full) + (("hindi",) if lang == "hi" else ())
    if hits:
        pool = "candidate"
    elif in_control_sample(source, source_id):
        pool = "control"
    else:
        pool = "excluded"
    return Screen(lang, hits, pool)

from engine.ai.prefilter import detect_lang, in_control_sample, keyword_hits, screen
from engine.ai.taxonomy import MULTI, SINGLE, taxonomy
from engine.ai.validate import clean_tags, is_grounded


# ---------- language

def test_detect_lang():
    assert detect_lang("Delivery was quick and the milk was fresh") == "en"
    assert detect_lang("मैने तो ब्लिंकिट में चोरी सामान देखा") == "hi"
    assert detect_lang("pet food kabhi try nahi kiya, pata nahi original hoga ya nahi") == "hinglish"
    assert detect_lang("") == "en"


# ---------- keyword screen

def test_keyword_groups():
    assert "category" in keyword_hits("Never bought pet food here")
    assert "trust" in keyword_hits("got an expired packet, is it even genuine")
    assert "habit" in keyword_hits("I always order the same items every day")
    assert "discovery" in keyword_hits("didn't know they sell baby products")
    assert "trust" in keyword_hits("nakli product bheja")


def test_noisy_words_do_not_trigger():
    # "tried calling", "phone", "review" alone are about support, not shopping
    assert keyword_hits("I tried calling support from my phone, worst review") == ()


def test_screen_pools_and_reproducible_control_sample():
    assert screen("play_store", "x1", None, "fake shampoo delivered").pool == "candidate"
    ids = [f"id{i}" for i in range(4000)]
    picked = [i for i in ids if in_control_sample("play_store", i)]
    assert 140 < len(picked) < 260  # ~5%
    assert picked == [i for i in ids if in_control_sample("play_store", i)]  # deterministic
    s = screen("play_store", picked[0], None, "delivery late again")
    assert s.pool == "control" and s.hits == ()


def test_hindi_always_goes_to_ai_gate():
    s = screen("play_store", "h1", None, "बहुत अच्छा सामान मिलता है बहुत जल्दी डिलीवरी")
    assert s.lang == "hi" and s.pool == "candidate"


def test_thread_title_counts_for_comments():
    assert screen("reddit_comment", "c", None, "same here", post_title="Blinkit pet food legit?").pool == "candidate"


# ---------- grounding (V3)

def test_grounding_tolerates_case_whitespace_quotes():
    src = "But pet food kabhi try nahi kiya,  pata nahi ORIGINAL hoga"
    assert is_grounded("pet food kabhi try nahi kiya, pata nahi original hoga", src)
    assert is_grounded("Didn’t even know they sold baby products", "Didn't even know they sold baby products")


def test_grounding_rejects_paraphrase_and_tiny_spans():
    assert not is_grounded("never tried pet food", "pet food kabhi try nahi kiya")
    assert not is_grounded("pet", "pet food")
    assert not is_grounded(None, "anything")


# ---------- schema (V4)

def test_clean_tags_drops_unknown_values_and_fixes_shapes():
    c = clean_tags({
        "sentiment": ["negative"], "categories": "pet", "barriers": ["quality_trust", "made_up", "quality_trust"],
        "funnel_stage": "nonsense", "discovery_channels": None, "habit_signal": "yes",
        "unmet_need": "null", "evidence_span": "  x  ", "english_translation": None, "confidence": "1.7",
    })
    t = c.tags
    assert t["sentiment"] == "negative"
    assert t["categories"] == ["pet"]
    assert t["barriers"] == ["quality_trust"]          # unknown dropped, duplicate removed
    assert t["funnel_stage"] == "none"
    assert t["discovery_channels"] == []
    assert t["unmet_need"] is None and t["confidence"] == 1.0
    assert "barriers=made_up" in c.dropped and "funnel_stage=nonsense" in c.dropped


def test_taxonomy_loads_and_covers_schema_fields():
    t = taxonomy()
    for f in SINGLE + MULTI:
        assert f in t and t[f]

"""Groq client against a fake HTTP server, and the stages end-to-end with a fake model + store."""

import json

import httpx
import pytest

from engine.ai import prompts
from engine.ai.groq import BudgetExhausted, GroqClient, ModelOutputError, parse_duration
from engine.ai.stages import run_phase_a


def test_parse_duration():
    assert parse_duration("6.705s") == pytest.approx(6.705)
    assert parse_duration("1m26.4s") == pytest.approx(86.4)
    assert parse_duration("2h3m") == 7380
    assert parse_duration("120ms") == pytest.approx(0.12)
    assert parse_duration(None) == 0


def _ok(content, headers=None):
    body = {"choices": [{"message": {"content": json.dumps(content)}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}
    return httpx.Response(200, json=body, headers=headers or {})


def client(handler, logs=None):
    sleeps = []
    c = GroqClient("k", log_call=(lambda **row: logs.append(row)) if logs is not None else None,
                   http=httpx.Client(transport=httpx.MockTransport(handler)), sleep=sleeps.append)
    return c, sleeps


def test_retries_after_rate_limit_then_succeeds_and_logs_tokens():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "3"}, text="tokens per minute")
        return _ok({"items": []})

    logs = []
    c, sleeps = client(handler, logs)
    res = c.chat_json(model="m", system="s", user="u", stage="t", items=1)
    assert res.data == {"items": []} and sleeps == [3.5]
    assert logs[-1]["ok"] and logs[-1]["tokens_in"] == 10


def test_persistent_minute_limit_pauses_without_counting_as_failure():
    from engine.ai.groq import MAX_RATE_WAITS, RateLimited

    c, sleeps = client(lambda req: httpx.Response(429, headers={"retry-after": "2"}, text="tokens per minute"))
    with pytest.raises(RateLimited):
        c.chat_json(model="m", system="s", user="u", stage="t", items=1)
    assert len(sleeps) == MAX_RATE_WAITS  # waited, didn't burn "attempts"


def test_rate_limited_stage_pauses_and_leaves_items_untouched():
    from engine.ai.groq import RateLimited

    class Limited(FakeGroq):
        def chat_json(self, **kw):
            raise RateLimited(kw["model"])

    store = FakeStore(RAW)
    res = run_phase_a(store, Limited(), ["screen", "relevance"], minutes=1)
    assert res["relevance"]["paused_rate_limit"] == 1
    assert all(s.get("attempts", 0) == 0 for s in store.screen.values())


def test_request_too_large_fails_fast_without_waiting():
    from engine.ai.groq import RequestTooLarge

    c, sleeps = client(lambda req: httpx.Response(
        429, headers={"retry-after": "1"},
        text='{"error":{"message":"Request too large for model on output tokens per minute (OTPM): Limit 1000"}}'))
    with pytest.raises(RequestTooLarge):
        c.chat_json(model="m", system="s", user="u", stage="t", items=1)
    assert sleeps == []


def test_daily_limit_stops_the_model():
    c, _ = client(lambda req: httpx.Response(429, headers={"retry-after": "4000"}, text="Limit on tokens per day"))
    with pytest.raises(BudgetExhausted):
        c.chat_json(model="m", system="s", user="u", stage="t", items=1)
    with pytest.raises(BudgetExhausted):  # stays stopped without calling again
        c.chat_json(model="m", system="s", user="u", stage="t", items=1)


def test_low_remaining_requests_marks_model_exhausted():
    c, _ = client(lambda req: _ok({"items": []}, {"x-ratelimit-remaining-requests": "1"}))
    c.chat_json(model="m", system="s", user="u", stage="t", items=1)
    with pytest.raises(BudgetExhausted):
        c.chat_json(model="m", system="s", user="u", stage="t", items=1)


def test_waits_when_minute_token_budget_is_low():
    c, sleeps = client(lambda req: _ok({"items": []}, {"x-ratelimit-remaining-tokens": "5",
                                                       "x-ratelimit-reset-tokens": "7s"}))
    c.chat_json(model="m", system="s", user="u", stage="t", items=1)
    c.chat_json(model="m", system="s" * 300, user="u", stage="t", items=1)
    assert sleeps and 0 < sleeps[0] <= 7


def test_invalid_json_raises():
    c, _ = client(lambda req: httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}], "usage": {}}))
    with pytest.raises(ModelOutputError):
        c.chat_json(model="m", system="s", user="u", stage="t", items=1)


def test_gpt_oss_requests_low_reasoning():
    seen = {}

    def handler(req):
        seen.update(json.loads(req.content))
        return _ok({"items": []})

    c, _ = client(handler)
    c.chat_json(model="openai/gpt-oss-20b", system="s", user="u", stage="t", items=1)
    assert seen["reasoning_effort"] == "low" and seen["response_format"] == {"type": "json_object"}


# ---------------------------------------------------------------- stages with fakes

class FakeStore:
    def __init__(self, raw):
        self.raw = [{"first_seen_at": "2026-11-01T00:00:00+00:00", **r} for r in raw]  # raw_items rows
        self.screen, self.tags, self.failed, self.calls = {}, {}, [], []

    def queue_screen(self, after, n):
        keyed = sorted(self.raw, key=lambda r: (r.get("first_seen_at", ""), r["source"], r["source_id"]))
        start = tuple(after) if after else ("", "", "")
        return [r for r in keyed if (r.get("first_seen_at", ""), r["source"], r["source_id"]) > start][:n]

    def get_state(self, key):
        return getattr(self, "_state", {}).get(key)

    def set_state(self, key, value):
        self._state = {**getattr(self, "_state", {}), key: value}

    def queue_relevance(self, n):
        out = []
        for k, s in self.screen.items():
            if s["pool"] in ("candidate", "control") and s.get("relevance") is None and s.get("attempts", 0) < 3:
                r = next(x for x in self.raw if (x["source"], x["source_id"]) == k)
                out.append({**r, "lang": s["lang"], "pool": s["pool"], "post_title": None})
        return out[:n]

    def queue_tagging(self, n):
        out = []
        for k, s in self.screen.items():
            if s.get("relevance") == "relevant" and k not in self.tags and s.get("attempts", 0) < 3:
                r = next(x for x in self.raw if (x["source"], x["source_id"]) == k)
                out.append({**r, "lang": s["lang"], "post_title": None})
        return out[:n]

    def queue_translation_check(self, n):
        return [{"source": k[0], "source_id": k[1], "text": next(x["text"] for x in self.raw if (x["source"], x["source_id"]) == k),
                 "translation": t["translation"]} for k, t in self.tags.items()
                if t.get("translation") and t.get("translation_score") is None][:n]

    def upsert(self, table, rows, on_conflict="source,source_id"):
        target = self.screen if table == "item_screen" else self.tags
        for r in rows:
            k = (r["source"], r["source_id"])
            target[k] = {**target.get(k, {}), **r}

    def mark_failed(self, keys, err):
        self.failed.append((keys, err))
        for k in keys:
            if k in self.screen:
                self.screen[k]["attempts"] = self.screen[k].get("attempts", 0) + 1


class FakeGroq:
    """Answers each stage the way a well-behaved model would, based on the entry text."""

    def __init__(self, unground_first=False):
        self.calls = []
        self.unground_first = unground_first

    def chat_json(self, *, model, system, user, stage, items, max_tokens=0, retries=4):
        from engine.ai.groq import CallResult

        self.calls.append((stage, model, items))
        entries = json.loads(user)
        if stage == "relevance":
            data = {"items": [{"id": e["id"], "relevant": "pet" in e["text"] or "kabhi" in e["text"], "reason": "x"}
                              for e in entries]}
        elif stage.startswith("tagging"):
            out = []
            for e in entries:
                span = e["text"][:30]
                if self.unground_first and stage == "tagging":
                    span = "this sentence is not in the review at all"
                out.append({"id": e["id"], "sentiment": "negative", "categories": ["pet"], "barriers": ["quality_trust"],
                            "category_behavior": "wants_but_hesitant", "funnel_stage": "trust", "discovery_channels": [],
                            "habit_signal": False, "info_needs": [], "segment_signals": ["pet_owner"], "unmet_need": None,
                            "evidence_span": span, "confidence": 0.8,
                            "english_translation": "I never tried pet food" if "kabhi" in e["text"] else None})
            data = {"items": out}
        else:  # translation check
            data = {"items": [{"id": e["id"], "score": 0.9, "issue": ""} for e in entries]}
        return CallResult(data, 10, 10)


RAW = [
    {"source": "play_store", "source_id": "a", "title": None, "text": "Never bought pet food here, not sure it is genuine", "meta": {}},
    {"source": "play_store", "source_id": "b", "title": None, "text": "pet food kabhi try nahi kiya, pata nahi original hoga", "meta": {}},
    {"source": "play_store", "source_id": "c", "title": None, "text": "delivery boy was rude and late again today", "meta": {}},
]


def test_phase_a_end_to_end():
    store, groq = FakeStore(RAW), FakeGroq()
    res = run_phase_a(store, groq, ["screen", "relevance", "tag", "translation"], minutes=1)
    assert res["screen"]["screened"] == 3
    assert store.screen[("play_store", "a")]["relevance"] == "relevant"
    assert set(store.tags) == {("play_store", "a"), ("play_store", "b")}
    a, b = store.tags[("play_store", "a")], store.tags[("play_store", "b")]
    assert a["evidence_grounded"] and a["barriers"] == ["quality_trust"] and a["translation"] is None
    assert b["translation"] == "I never tried pet food" and b["translation_ok"] is True
    assert a["model"] == prompts.MODEL_TAGGING and a["prompt_version"] == prompts.PROMPT_VERSION
    # different model families for producing vs checking
    models = {stage: m for stage, m, _ in groq.calls}
    assert models["relevance"] != models["tagging"] and models["translation_check"] != models["tagging"]


def test_ungrounded_quote_is_retried_once():
    store, groq = FakeStore(RAW[:1]), FakeGroq(unground_first=True)
    res = run_phase_a(store, groq, ["screen", "relevance", "tag"], minutes=1)
    assert store.tags[("play_store", "a")]["evidence_grounded"] is True
    assert res["tag"]["retried_grounded"] == 1
    assert [s for s, _, _ in groq.calls].count("tagging_retry") == 1


def test_daily_limit_stops_stage_cleanly():
    class Exhausted(FakeGroq):
        def chat_json(self, **kw):
            raise BudgetExhausted(kw["model"])

    store = FakeStore(RAW)
    res = run_phase_a(store, Exhausted(), ["screen", "relevance", "tag"], minutes=1)
    assert res["relevance"]["stopped_daily_limit"] == 1
    assert res["screen"]["screened"] == 3 and not store.tags


def test_bad_output_marks_items_failed_and_moves_on():
    class Broken(FakeGroq):
        def chat_json(self, **kw):
            raise ModelOutputError("invalid JSON")

    store = FakeStore(RAW)
    res = run_phase_a(store, Broken(), ["screen", "relevance"], minutes=0.05)
    # each candidate/control item retried until retired after 3 attempts, never looping forever
    assert all(s.get("attempts", 0) == 3 for s in store.screen.values() if s["pool"] != "excluded")
    assert res["relevance"]["failed_items"] >= 1


def test_no_key_skips_ai_stages_but_screens():
    store = FakeStore(RAW)
    res = run_phase_a(store, None, ["screen", "relevance"], minutes=1)
    assert res["screen"]["screened"] == 3 and res["relevance"] == {"skipped": "GROQ_API_KEY not set"}


def test_lane_gives_every_stage_turns_while_upstream_runs(monkeypatch):
    """Regression: the translation check (waiting on tagging) used to starve the cross-check."""
    import time as _t

    from engine.ai import stages

    calls = []

    def fake_run_one(stage, store, groq, deadline):
        calls.append(stage)
        if stage == "tag":  # upstream keeps working for a while
            _t.sleep(0.3)
            return {"tagged": 1}
        if stage == "crosscheck" and calls.count("crosscheck") <= 2:
            return {"crosschecked": 1}
        return {}

    monkeypatch.setattr(stages, "_run_one", fake_run_one)
    res = stages.run_phase_a(object(), object(), ["tag", "translation", "crosscheck"], minutes=0.02)
    assert "crosscheck" in calls and res["crosscheck"]["crosschecked"] == 2
    assert calls.index("crosscheck") < len(calls) - 1  # reached early, not only at the very end


def test_screen_bookmark_only_reads_new_rows():
    store = FakeStore(RAW)
    run_phase_a(store, None, ["screen"], minutes=1)
    assert len(store.screen) == 3
    store.raw.append({"source": "play_store", "source_id": "d", "title": None, "text": "baby diapers fake",
                      "meta": {}, "first_seen_at": "2026-11-02T00:00:00+00:00"})
    res = run_phase_a(store, None, ["screen"], minutes=1)
    assert res["screen"]["screened"] == 1 and store.screen[("play_store", "d")]["pool"] == "candidate"


def test_bad_json_batch_is_split_and_good_half_saved():
    class HalfBroken(FakeGroq):
        def chat_json(self, **kw):
            entries = json.loads(kw["user"])
            if kw["stage"] == "tagging" and any("kabhi" in e["text"] for e in entries) and len(entries) > 1:
                raise ModelOutputError("HTTP 400: json_validate_failed")
            return super().chat_json(**kw)

    store = FakeStore(RAW)
    res = run_phase_a(store, HalfBroken(), ["screen", "relevance", "tag"], minutes=1)
    assert res["tag"]["split_batches"] == 1
    assert set(store.tags) == {("play_store", "a"), ("play_store", "b")}  # both halves recovered


def test_daily_cap_stops_pipeline_stages_but_not_theme_naming():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return _ok({"items": []})  # 15 tokens per call

    c, _ = client(handler)
    c.caps, c.used = {"m": 20}, {"m": 10}
    c.chat_json(model="m", system="s", user="u", stage="tagging", items=1)  # 10 -> 25, over the cap
    with pytest.raises(BudgetExhausted):
        c.chat_json(model="m", system="s", user="u", stage="tagging", items=1)
    c.chat_json(model="m", system="s", user="u", stage="theme_naming", items=1)  # exempt
    assert calls["n"] == 2 and c.used["m"] == 40


def test_pipeline_leaves_per_minute_headroom_for_the_chat():
    # 4,050 tokens left this minute; a small call needs ~100. With a 4,000 reserve for the chat the
    # pipeline waits for the minute to reset; without one it goes ahead.
    def handler(req):
        return _ok({"items": []}, headers={"x-ratelimit-remaining-tokens": "4050", "x-ratelimit-reset-tokens": "7s"})

    for reserve, expect_wait in ((4000, True), (0, False)):
        c, sleeps = client(handler)
        c.tpm_reserve = {"m": reserve}
        for _ in range(2):  # the first call learns the remaining budget from the headers
            c.chat_json(model="m", system="s", user="u", stage="crosscheck", items=1, max_tokens=200)
        assert bool(sleeps) is expect_wait

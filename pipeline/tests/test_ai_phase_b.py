"""Phase B logic with fakes: metric maths, clustering, theme naming, cross-check, metric computation."""

import numpy as np
import pytest

from engine.ai import themes as th
from engine.ai import validation as va
from engine.ai.embed import text_for, to_pgvector
from engine.ai.groq import CallResult, ModelOutputError


# ---------- metric maths

def test_cohen_kappa_known_values():
    assert va.cohen_kappa(["a", "b", "a", "b"], ["a", "b", "a", "b"]) == 1.0
    # textbook example: po=0.7, pe=0.5 → κ=0.4
    a = ["y"] * 25 + ["n"] * 25
    b = ["y"] * 20 + ["n"] * 5 + ["y"] * 10 + ["n"] * 15
    assert va.cohen_kappa(a, b) == pytest.approx(0.4)
    assert va.cohen_kappa([], []) is None


def test_multilabel_agreement_ignores_rare_labels():
    a = [["x"], ["x"], ["x"], [], [], ["rare"]]
    b = [["x"], ["x"], [], [], [], []]
    m = va.multilabel_agreement(a, b, {"x", "rare"}, min_support=3)
    assert "rare" not in m["per_label"] and "x" in m["per_label"]
    assert 0 < m["jaccard"] < 1


def test_stars_to_sentiment():
    assert va.stars_to_sentiment(1) == "negative" and va.stars_to_sentiment(5) == "positive"
    assert va.stars_to_sentiment(3) is None and va.stars_to_sentiment(None) is None


# ---------- embeddings helpers

def test_text_for_uses_verified_translation_only():
    assert text_for({"text": "hindi", "translation": "english", "translation_ok": True}) == "english"
    assert text_for({"text": "hindi", "translation": "english", "translation_ok": False}) == "hindi"
    assert text_for({"title": "T", "text": "body"}) == "T. body"
    assert to_pgvector(np.array([0.5, -1.0])) == "[0.500000,-1.000000]"


# ---------- clustering + themes

def _blobs(n_per=80, dims=384, k=3, seed=0):
    rng = np.random.default_rng(seed)
    centres = rng.normal(size=(k, dims))
    pts = np.vstack([c + rng.normal(scale=0.15, size=(n_per, dims)) for c in centres])
    pts /= np.linalg.norm(pts, axis=1, keepdims=True)
    return pts, np.repeat(np.arange(k), n_per)


def test_cluster_recovers_separated_groups():
    emb, truth = _blobs()
    labels, params = th.cluster(emb)
    found = {l for l in labels if l >= 0}
    assert len(found) == 3
    for t in range(3):  # each true group maps mostly to one cluster
        assigned = labels[truth == t]
        assigned = assigned[assigned >= 0]
        assert np.bincount(assigned).max() / len(assigned) > 0.9
    assert params["hdbscan"]["min_cluster_size"] >= 12


def test_theme_stats_computed_in_code():
    rows = [{"source": "play_store", "rating": 1, "sentiment": "negative", "barriers": ["quality_trust"],
             "categories": ["pet"], "posted_at": "2026-10-02T00:00:00Z"},
            {"source": "play_store", "rating": 3, "sentiment": "mixed", "barriers": ["quality_trust", "price_fees"],
             "categories": [], "posted_at": "2026-11-02T00:00:00Z"}]
    s = th.theme_stats(rows)
    assert s["size"] == 2 and s["avg_rating"] == 2.0 and s["pct_negative"] == 50.0
    assert s["top_barriers"][0] == ["quality_trust", 2]
    assert s["monthly"] == {"2026-10": 1, "2026-11": 1}


def test_representatives_prefer_verified_quotes():
    emb = np.eye(4, dtype=np.float32)
    emb[1] = emb[0]  # 0 and 1 identical, closest to the centre of {0,1,2}
    rows = [{"evidence_grounded": False}, {"evidence_grounded": True}, {"evidence_grounded": True}, {}]
    reps = th.representatives(np.array([0, 1, 2]), emb, rows, 3)
    assert reps[0] == 1 and reps[-1] == 0  # grounded first, ungrounded last


class NamerGroq:
    def __init__(self, data):
        self.data = data

    def chat_json(self, **kw):
        return CallResult(self.data, 1, 1)


def test_name_theme_validates_output():
    stats = th.theme_stats([{"source": "s", "barriers": [], "categories": []}])
    out = th.name_theme(NamerGroq({"name": "Fear of expired dairy", "description": "Users report stale milk.",
                                   "kind": "not-a-kind", "questions": [2, "6", 9, "x"]}), stats, ["q"])
    assert out["kind"] == "general_friction" and out["questions"] == [2, 6]
    with pytest.raises(ModelOutputError):
        th.name_theme(NamerGroq({"name": "", "description": ""}), stats, ["q"])


class ThemeStore:
    def __init__(self, n=240):
        emb, _ = _blobs(n_per=n // 3)
        self.keys = [("play_store", str(i)) for i in range(len(emb))]
        self.emb = emb.astype(np.float32)
        self.saved = None

    def load_embeddings(self):
        return self.keys, self.emb

    def load_theme_inputs(self):
        return {k: {"source": k[0], "source_id": k[1], "rating": 2, "sentiment": "negative", "barriers": ["stockout"],
                    "categories": [], "evidence_span": f"quote {k[1]}", "evidence_grounded": True,
                    "posted_at": "2026-11-01", "text": "t"} for k in self.keys}

    def save_theme_snapshot(self, **kw):
        self.saved = kw
        return 7


def test_run_themes_end_to_end_and_publish_gate():
    store = ThemeStore()
    res = th.run_themes(store, NamerGroq({"name": "Stockouts of daily items", "description": "Users find items missing.",
                                          "kind": "exploration_barrier", "questions": [2]}))
    assert res["snapshot"] == 7 and res["themes"] == 3
    t0 = store.saved["themes"][0]
    assert t0["rep_keys"] and t0["share"] > 0 and t0["top_barriers"][0][0] == "stockout"
    assert len(store.saved["members"]) + res["outliers"] == res["entries"]

    class Failing:
        def chat_json(self, **kw):
            raise ModelOutputError("bad")

    store2 = ThemeStore()
    assert "skipped" in th.run_themes(store2, Failing()) and store2.saved is None  # nothing published


def test_run_themes_needs_enough_entries():
    store = ThemeStore(n=60)
    assert "skipped" in th.run_themes(store, NamerGroq({}))


# ---------- cross-check + metrics

class CrossStore:
    def __init__(self):
        self.rows, self.metrics = {}, []
        self.served = False

    def queue_crosscheck(self, n):
        if self.served:
            return []
        self.served = True
        return [{"source": "play_store", "source_id": str(i), "title": None, "text": f"text {i}"} for i in range(3)]

    def upsert(self, table, rows, on_conflict=None):
        for r in rows:
            self.rows[(r["source"], r["source_id"])] = r


class CrossGroq:
    def chat_json(self, **kw):
        assert kw["stage"] == "crosscheck"
        return CallResult({"items": [{"id": str(i), "sentiment": "negative", "barriers": ["stockout", "bogus"],
                                      "categories": [], "category_behavior": "none", "funnel_stage": "none"}
                                     for i in (1, 2, 3)]}, 1, 1)


def test_crosscheck_stores_cleaned_subset():
    import time

    store = CrossStore()
    res = va.run_crosscheck(store, CrossGroq(), time.time() + 5)
    assert res["crosschecked"] == 3
    r = store.rows[("play_store", "0")]
    assert r["barriers"] == ["stockout"] and r["model"] != "openai/gpt-oss-120b"


class MetricStore:
    def load_tags_for_validation(self):
        base = {"categories": [], "category_behavior": "none", "funnel_stage": "none", "raw": {"sentiment": "negative"}}
        return {
            ("p", "1"): {**base, "sentiment": "negative", "barriers": ["stockout"], "rating": 1, "evidence_grounded": True,
                         "translation_score": 0.9, "translation_ok": True},
            ("p", "2"): {**base, "sentiment": "positive", "barriers": [], "rating": 5, "evidence_grounded": True,
                         "translation_score": 0.3, "translation_ok": False},
            ("p", "3"): {**base, "sentiment": "positive", "barriers": [], "rating": 1, "evidence_grounded": False},
        }

    def load_table_by_key(self, table, latest_week=False):
        if table == "item_crosscheck":
            return {("p", "1"): {"sentiment": "negative", "barriers": ["stockout"], "categories": [],
                                 "category_behavior": "none", "funnel_stage": "none"},
                    ("p", "2"): {"sentiment": "negative", "barriers": [], "categories": [],
                                 "category_behavior": "none", "funnel_stage": "none"}}
        return {}

    def load_funnel(self):
        return {"control_checked": 100, "control_relevant": 5, "candidates_checked": 200, "candidates_relevant": 120,
                "candidates": 1000, "excluded": 4000, "control_sample": 200}

    def insert_metrics(self, rows):
        self.rows = rows


def test_compute_metrics_values():
    store = MetricStore()
    m = va.compute_metrics(store)
    assert m["v2_sentiment_vs_stars"] == pytest.approx(2 / 3, abs=1e-3)   # item 3 disagrees with its stars
    assert m["v3_grounding"] == pytest.approx(2 / 3, abs=1e-3)
    assert m["v8_translation"] == 0.5
    assert m["v4_schema"] == 1.0
    # recall: found = 0.6*1000 = 600; missed = 0.05*4200 = 210 → 600/810
    assert m["v6_keyword_recall"] == pytest.approx(600 / 810, abs=1e-3)
    assert "v1_sentiment" in m and {r["metric"] for r in store.rows} >= {"v1_barriers", "v2_sentiment_vs_stars"}

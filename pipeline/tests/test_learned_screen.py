"""Learned screen with a fake store and a fake embedder: no model download, no database."""

import numpy as np

from engine.ai import learned_screen as ls


class FakeEmbedder:
    """Two features: does the text talk about products/categories, or about delivery. Plus noise."""

    def __init__(self):
        self.rng = np.random.default_rng(0)

    def embed(self, texts):
        out = []
        for t in texts:
            t = t.lower()
            v = np.array([("pet" in t or "skincare" in t) * 1.0, ("late" in t) * 1.0, *self.rng.normal(0, 0.1, 2)])
            out.append(v)
        return np.array(out)


class FakeStore:
    def __init__(self, training, queue):
        self.training, self.queue, self.writes, self.state = training, list(queue), [], {}

    def rpc(self, fn, **kw):
        if fn == "ai_screen_training":
            return self.training[kw.get("skip", 0): kw.get("skip", 0) + kw["n"]]
        if fn == "ai_queue_rescreen":
            batch, self.queue = self.queue[: kw["n"]], self.queue[kw["n"]:]
            return batch
        if fn == "ai_set_screen_scores":
            self.writes += kw["rows"]
            return len(kw["rows"])
        raise AssertionError(fn)

    def set_state(self, key, value):
        self.state[key] = value


def training(n_each=200):
    rows = []
    for i in range(n_each):
        pool = "control" if i % 5 == 0 else "candidate"
        rows.append({"pool": pool, "relevant": True, "title": None, "text": f"Is the pet food genuine {i}", "post_title": None})
        rows.append({"pool": pool, "relevant": False, "title": None, "text": f"Delivery was late again {i}", "post_title": None})
    return rows


def setup_function():
    ls._MODEL.clear()


def test_scores_skipped_entries_and_promotes_likely_relevant_ones():
    queue = [{"source": "play_store", "source_id": f"a{i}", "title": None, "text": "skincare and pet items, are they original?", "post_title": None}
             for i in range(3)] + [{"source": "play_store", "source_id": f"b{i}", "title": None, "text": "order came late", "post_title": None}
                                   for i in range(3)]
    store = FakeStore(training(), queue)
    out = ls.run_rescreen(store, FakeEmbedder(), deadline=float("inf"))
    assert out["scored"] == 6 and out["promoted"] == 3 and out["trained"] == 1
    promoted = {w["source_id"] for w in store.writes if w["promote"]}
    assert promoted == {"a0", "a1", "a2"}
    assert all(w["model"] == ls.MODEL_VERSION for w in store.writes)
    m = store.state[ls.STATE_KEY]
    assert m["auc"] > 0.9 and m["control_recall"] > 0.9 and m["control_n"] == 80


def test_waits_when_there_are_too_few_gate_decisions():
    store = FakeStore(training(n_each=50), [{"source": "s", "source_id": "x", "title": None, "text": "t", "post_title": None}])
    out = ls.run_rescreen(store, FakeEmbedder(), deadline=float("inf"))
    assert "skipped" in out and not store.writes


def test_model_is_trained_once_per_run():
    store = FakeStore(training(), [])
    ls.run_rescreen(store, FakeEmbedder(), deadline=float("inf"))
    store.training = []  # a second call in the same run must not need training data
    out = ls.run_rescreen(store, FakeEmbedder(), deadline=float("inf"))
    assert "skipped" not in out and "trained" not in out


def test_training_reads_past_the_1000_row_page_limit():
    store = FakeStore(training(n_each=600), [])  # 1,200 decisions: two pages
    ls.run_rescreen(store, FakeEmbedder(), deadline=float("inf"))
    assert store.state[ls.STATE_KEY]["n_train"] == 1200

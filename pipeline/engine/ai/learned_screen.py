"""S1b learned screen: finds relevant feedback the keyword pre-filter misses. No AI tokens spent.

The keyword screen reached only ~28% of relevant feedback (V6, measured on the control sample).
This stage trains a small classifier (logistic regression on gte-small embeddings) on the AI
relevance gate's own past decisions, scores the entries the keywords skipped, and moves the likely
relevant ones to the pool 'promoted', where the relevance gate picks them up like any candidate.

Measured before building (2026-11-24, 2,619 gate decisions, 5-fold cross-validation): AUC 0.88; on
the control sample (entries with no keyword hit) a 0.5 threshold sent 34% of them to the gate and
caught 71% of the relevant ones, at 77% precision, better than the keyword candidates' 64%.

The control sample is never scored or moved: it keeps measuring recall, now of both screens together.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import numpy as np

log = logging.getLogger("engine.ai.learned_screen")

MODEL_VERSION = "screen-v1"
THRESHOLD = 0.5
TRAIN_MAX = 4_000      # gate decisions used for training (random sample)
MIN_TRAIN = 300        # below this, or with too few of either class, the stage waits
BATCH = 256            # entries scored per database round trip
MAX_SECONDS = 40 * 60  # leaves the runner's CPU for embeddings and themes later in the run
STATE_KEY = "learned_screen"

# One model per pipeline run: the lane loop calls the stage repeatedly in time slices.
_MODEL: dict[str, Any] = {}


def text_for(row: dict[str, Any]) -> str:
    """What the screen reads: video or thread title for context, then the entry itself."""
    parts = [row.get("post_title"), row.get("title"), row.get("text")]
    return ". ".join(p for p in parts if p)[:2000]


def _embed(embedder: Any, texts: list[str]) -> np.ndarray:
    return np.vstack([embedder.embed(texts[i:i + 32]) for i in range(0, len(texts), 32)])


def train(store: Any, embedder: Any) -> dict[str, Any] | None:
    """Fits the classifier and measures it with 5-fold cross-validation. None if data is too thin."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    rows: list[dict] = []
    while len(rows) < TRAIN_MAX:  # the database API returns at most 1,000 rows per call
        page = store.rpc("ai_screen_training", n=min(1000, TRAIN_MAX - len(rows)), skip=len(rows))
        rows += page
        if len(page) < 1000:
            break
    y = np.array([bool(r["relevant"]) for r in rows])
    if len(rows) < MIN_TRAIN or y.sum() < 50 or (~y).sum() < 50:
        return None
    X = _embed(embedder, [text_for(r) for r in rows])
    clf = LogisticRegression(C=2.0, max_iter=2000, class_weight="balanced")
    p = cross_val_predict(clf, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=42), method="predict_proba")[:, 1]
    # Recall and precision where it matters: entries with no keyword hit (the control sample).
    ctrl = np.array([r["pool"] == "control" for r in rows])
    sel, rel = p[ctrl] >= THRESHOLD, y[ctrl]
    metrics = {
        "version": MODEL_VERSION, "threshold": THRESHOLD, "n_train": int(len(rows)),
        "auc": round(float(roc_auc_score(y, p)), 4),
        "control_n": int(ctrl.sum()), "control_relevant": int(rel.sum()),
        "control_recall": round(float((sel & rel).sum() / rel.sum()), 4) if rel.sum() else None,
        "control_precision": round(float((sel & rel).sum() / sel.sum()), 4) if sel.sum() else None,
        "control_promoted_share": round(float(sel.mean()), 4) if ctrl.sum() else None,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    clf.fit(X, y)
    return {"clf": clf, "metrics": metrics}


def run_rescreen(store: Any, embedder: Any, deadline: float) -> dict:
    stats: Counter = Counter()
    deadline = min(deadline, time.time() + MAX_SECONDS)
    if "model" not in _MODEL:
        trained = train(store, embedder)
        if trained is None:
            return {"skipped": "not enough relevance-gate decisions to train on yet"}
        _MODEL["model"] = trained
        store.set_state(STATE_KEY, trained["metrics"])
        log.info("learned screen trained: %s", trained["metrics"])
        stats["trained"] = 1
    clf = _MODEL["model"]["clf"]
    while time.time() < deadline:
        rows = store.rpc("ai_queue_rescreen", n=BATCH)
        if not rows:
            break
        p = clf.predict_proba(_embed(embedder, [text_for(r) for r in rows]))[:, 1]
        updates = [{"source": r["source"], "source_id": r["source_id"], "score": round(float(s), 4),
                    "model": MODEL_VERSION, "promote": bool(s >= THRESHOLD)} for r, s in zip(rows, p)]
        store.rpc("ai_set_screen_scores", rows=updates)
        stats["scored"] += len(updates)
        stats["promoted"] += sum(u["promote"] for u in updates)
    return dict(stats)

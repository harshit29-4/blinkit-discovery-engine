"""Play Store: reviews under 40 chars become rating-only rows (decision 2026-11-23)."""

from datetime import datetime, timedelta, timezone

from engine import collect as runner
from engine.collectors import play_store
from engine.models import RawItem, ShortReview
from engine.store.local import LocalStore

NOW = datetime.now()  # the library returns naive local time
LONG = "Never tried the pet food here, not sure it's genuine and returns are a pain"


def fake_reviews_factory(batches):
    """Mimics google_play_scraper.reviews: returns successive batches, then empty."""
    calls = {"n": 0}

    class Token:
        token = "t"

    def fake(app_id, lang, country, sort, count, continuation_token):
        i = calls["n"]
        calls["n"] += 1
        if lang != "en" or i >= len(batches):
            return [], None
        return batches[i], Token()

    return fake


def _r(rid, content, minutes_ago, score=5):
    return {"reviewId": rid, "userName": "u", "content": content, "score": score,
            "at": NOW - timedelta(minutes=minutes_ago)}


def test_short_reviews_split_from_long(monkeypatch):
    batch = [_r("a", "good", 1), _r("b", LONG, 2, score=2), _r("c", "", 3, score=1)]
    monkeypatch.setattr(play_store, "reviews", fake_reviews_factory([batch]))
    out = list(play_store.PlayStoreCollector().collect(since=datetime.now(timezone.utc) - timedelta(days=1)))
    assert [type(o).__name__ for o in out] == ["ShortReview", "RawItem", "ShortReview"]
    assert out[2].rating == 1  # rating-only reviews still count for rating stats


def test_max_items_counts_only_long_reviews(monkeypatch):
    batch = [_r(str(i), "nice", i) for i in range(5)] + [_r("L1", LONG, 10), _r("L2", LONG, 11)]
    monkeypatch.setattr(play_store, "reviews", fake_reviews_factory([batch]))
    out = list(play_store.PlayStoreCollector().collect(since=datetime.now(timezone.utc) - timedelta(days=1),
                                                       max_items=1))
    assert sum(isinstance(o, RawItem) for o in out) == 1
    assert sum(isinstance(o, ShortReview) for o in out) == 5


def test_review_moving_between_short_and_long_is_never_double_counted(tmp_path):
    store = LocalStore(tmp_path / "t.sqlite")
    t = datetime(2026, 11, 1, tzinfo=timezone.utc)
    store.upsert_short([ShortReview("play_store", "x", t, 4, "en")])
    store.upsert_raw([RawItem(source="play_store", source_id="x", text=LONG, posted_at=t, rating=4)])
    assert store.db.execute("select count(*) from short_reviews").fetchone()[0] == 0
    store.upsert_short([ShortReview("play_store", "x", t, 4, "en")])  # edited back to "good"
    assert store.db.execute("select count(*) from raw_items").fetchone()[0] == 0
    assert store.short_review_daily() == [("play_store", "2026-11-01", 4, 1)]


def test_short_upsert_is_idempotent(tmp_path):
    store = LocalStore(tmp_path / "t.sqlite")
    t = datetime(2026, 11, 1, tzinfo=timezone.utc)
    rows = [ShortReview("play_store", str(i), t, 5, "en") for i in range(3)]
    store.upsert_short(rows)
    store.upsert_short(rows)  # overlap on the next incremental run
    assert store.short_review_daily() == [("play_store", "2026-11-01", 5, 3)]


def test_runner_stores_both_kinds(tmp_path, monkeypatch):
    batch = [_r("a", "good", 1), _r("b", LONG, 2)]
    monkeypatch.setattr(play_store, "reviews", fake_reviews_factory([batch]))
    store = LocalStore(tmp_path / "t.sqlite")
    result = runner.run_collect(store, ["play_store"], "backfill", None, "manual")
    s = result["sources"]["play_store"]
    assert (s["seen"], s["short_seen"], s["new"]) == (1, 1, 1)
    assert store.get_cursor("play_store") is not None

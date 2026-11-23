"""The runner stores items before moving any cursor."""

from datetime import datetime, timezone

from engine import collect as runner
from engine.models import CursorAdvance, RawItem
from engine.store.local import LocalStore

T = datetime(2026, 11, 1, tzinfo=timezone.utc)


class FakeCollector:
    def __init__(self, store_ref):
        self.store_ref = store_ref

    def collect(self, since, max_items=None):
        yield RawItem(source="reddit_post", source_id="a", text="x", posted_at=T)
        # By the time the runner handles this marker, item "a" must already be stored.
        yield CursorAdvance("reddit_sub:x", T)
        assert ("reddit_post", "a") in self.store_ref.existing_keys([("reddit_post", "a")])
        raise RuntimeError("killed mid-run")


def test_cursor_saved_only_after_items_and_survives_crash(tmp_path, monkeypatch):
    store = LocalStore(tmp_path / "t.sqlite")
    monkeypatch.setitem(runner.COLLECTORS, "reddit", lambda: FakeCollector(store))
    result = runner.run_collect(store, ["reddit"], "backfill", None, "manual")
    assert result["status"] == "failed"                      # the crash is reported...
    assert store.get_cursor("reddit_sub:x") == T             # ...but progress before it is kept
    assert store.existing_keys([("reddit_post", "a")])

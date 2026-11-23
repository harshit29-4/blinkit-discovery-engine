from datetime import datetime, timedelta, timezone

from engine.models import RawItem
from engine.store.local import LocalStore


def _item(i: str, text: str = "t", days_ago: int = 0) -> RawItem:
    return RawItem(source="app_store", source_id=i, text=text,
                   posted_at=datetime(2026, 11, 1, tzinfo=timezone.utc) - timedelta(days=days_ago))


def test_upsert_counts_only_new_and_updates_text(tmp_path):
    store = LocalStore(tmp_path / "t.sqlite")
    assert store.upsert_raw([_item("1"), _item("2")]) == 2
    assert store.upsert_raw([_item("2", text="edited"), _item("3")]) == 1
    rows = dict(store.db.execute("select source_id, text from raw_items").fetchall())
    assert rows == {"1": "t", "2": "edited", "3": "t"}


def test_cursor_only_moves_forward(tmp_path):
    store = LocalStore(tmp_path / "t.sqlite")
    newer = datetime(2026, 11, 10, tzinfo=timezone.utc)
    store.set_cursor("app_store", newer)
    store.set_cursor("app_store", newer - timedelta(days=5))
    assert store.get_cursor("app_store") == newer


def test_run_log(tmp_path):
    store = LocalStore(tmp_path / "t.sqlite")
    run = store.start_run("collect", "manual")
    store.finish_run(run, "ok", {"n": 1})
    assert store.db.execute("select status from pipeline_runs where id = ?", (run,)).fetchone()[0] == "ok"

"""YouTube collector logic with a fake API: no network, no quota."""

from datetime import datetime, timedelta, timezone

import pytest

from engine.collectors.youtube import YouTubeCollector, YouTubeError, query_cursor_key
from engine.config import SETTINGS
from engine.models import CursorAdvance, RawItem

NOW = datetime.now(timezone.utc)
SINCE = NOW - timedelta(days=365)
LONG = "Ordered pet food on Blinkit for the first time, it came in 10 minutes"


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def at(days_ago):
    return datetime.fromisoformat(iso(NOW - timedelta(days=days_ago)).replace("Z", "+00:00"))


def video(vid, title, days_ago, description=""):
    return {"id": {"videoId": vid}, "snippet": {"title": title, "description": description, "channelTitle": "c",
                                                 "publishedAt": iso(NOW - timedelta(days=days_ago))}}


def thread(cid, text, replies=()):
    top = {"id": cid, "snippet": {"textOriginal": text, "authorDisplayName": "a", "publishedAt": iso(NOW), "likeCount": 2}}
    th = {"snippet": {"topLevelComment": top}}
    if replies:
        th["replies"] = {"comments": [{"id": f"{cid}.r{i}", "snippet": {"textOriginal": t, "authorDisplayName": "b",
                                                                         "publishedAt": iso(NOW)}}
                                      for i, t in enumerate(replies)]}
    return th


class FakeApi:
    def __init__(self, videos, comments=None, errors=None):
        self.videos = videos              # returned by every search
        self.comments = comments or {}    # video id -> list of threads
        self.errors = errors or {}        # video id -> YouTube reason code
        self.calls = []

    def get(self, endpoint, params):
        self.calls.append((endpoint, params))
        if endpoint == "search":
            return {"items": self.videos}
        vid = params["videoId"]
        if vid in self.errors:
            raise YouTubeError(403, self.errors[vid])
        return {"items": self.comments.get(vid, [])}


@pytest.fixture
def settings():
    """Override SETTINGS (a frozen dataclass) for one test, restoring it afterwards."""
    saved = {}

    def set_(**kw):
        for k, v in kw.items():
            saved.setdefault(k, getattr(SETTINGS, k))
            object.__setattr__(SETTINGS, k, v)

    set_(youtube_queries=("blinkit",))
    yield set_
    for k, v in saved.items():
        object.__setattr__(SETTINGS, k, v)


def run(collector):
    return list(collector.collect(since=SINCE))


def test_comments_only_for_videos_titled_about_blinkit(settings):
    api = FakeApi([video("v1", "My Blinkit haul", 3),
                   video("v2", "Paneer butter masala recipe", 2, description="Ingredients ordered from Blinkit")],
                  {"v1": [thread("c1", LONG, replies=[LONG + " too", "ok"])], "v2": [thread("c2", LONG)]})
    c = YouTubeCollector(api)
    out = run(c)
    items = [i for i in out if isinstance(i, RawItem)]
    assert [i.source_id for i in items] == ["c1", "c1.r0"]  # short reply dropped, sponsor-mention video skipped
    assert items[0].source == "youtube_comment"
    assert items[0].meta["post_title"] == "My Blinkit haul" and items[0].meta["is_top_level"]
    assert items[1].meta["parent_id"] == "c1"
    assert items[0].url.endswith("v=v1&lc=c1") and items[0].author_hash and items[0].author_hash != "a"
    assert c.skipped_threads == 1
    assert not any(p.get("videoId") == "v2" for _, p in api.calls)  # no quota spent on v2's comments
    assert out[-1] == CursorAdvance(query_cursor_key("blinkit"), at(3))  # cursor = newest finished video


def test_first_run_searches_by_relevance_then_by_date(settings):
    api = FakeApi([])
    run(YouTubeCollector(api))
    assert api.calls[0][1]["order"] == "relevance"
    api = FakeApi([])
    c = YouTubeCollector(api)
    c.get_cursor = lambda key: NOW - timedelta(days=30)
    run(c)
    assert api.calls[0][1]["order"] == "date"


def test_disabled_comments_are_skipped_but_a_failure_holds_the_cursor(settings):
    vids = [video("old", "Blinkit review", 10), video("bad", "Blinkit order", 5), video("new", "Blinkit vs Zepto", 1)]
    comments = {"old": [thread("a", LONG)], "new": [thread("b", LONG)]}

    c = YouTubeCollector(FakeApi(vids, comments, errors={"bad": "processingFailure"}))
    adv = [i for i in run(c) if isinstance(i, CursorAdvance)]
    # "new" was stored, but the cursor stays at "old": "bad" must be read again next run.
    assert [a.value for a in adv] == [at(10)] and c.failed_threads == 1

    c2 = YouTubeCollector(FakeApi(vids, comments, errors={"bad": "commentsDisabled"}))
    adv2 = [i for i in run(c2) if isinstance(i, CursorAdvance)]
    assert [a.value for a in adv2] == [at(1)] and c2.disabled_comments == 1 and c2.failed_threads == 0


def test_run_budget_stops_cleanly(settings):
    settings(youtube_quota_per_run=150)  # one search (100 units) + at most 50 comment pages (1 each)
    vids = [video(f"v{i}", "Blinkit haul", i + 1) for i in range(80)]
    c = YouTubeCollector(FakeApi(vids, {f"v{i}": [thread(f"c{i}", LONG)] for i in range(80)}))
    out = run(c)
    assert c.stopped_early and c.units <= 150
    assert len([i for i in out if isinstance(i, RawItem)]) == 50

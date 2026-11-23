"""Reddit collector logic with a fake HTTP client: no network."""

from datetime import datetime, timedelta, timezone

from engine.collectors.reddit import STALL_LIMIT, RedditCollector, sub_cursor_key
from engine.config import SETTINGS
from engine.models import CursorAdvance, RawItem


def raw(items):
    return [i for i in items if isinstance(i, RawItem)]

NOW = datetime.now(timezone.utc)
START = NOW - timedelta(days=365)


class FakeHttp:
    """posts/search overloads on windows longer than `overload_days` (all windows if None
    is passed as `ok_days`). Returns `posts` falling inside the window, or one synthetic
    post per call. comments/search returns two comments per thread."""

    def __init__(self, overload_days: float = 100, posts=None, fail_comments=False):
        self.overload_days = overload_days
        self.calls: list[tuple[str, dict]] = []
        self.posts = posts
        self.fail_comments = fail_comments

    def get_json(self, url, params=None, max_retries=None):
        endpoint = url.rsplit("/api/", 1)[1]
        self.calls.append((endpoint, params))
        if endpoint == "posts/search":
            span = timedelta(seconds=params["before"] - params["after"])
            if span > timedelta(days=self.overload_days):
                raise RuntimeError("server overloaded (422)")
            if self.posts is not None:
                return {"data": [p for p in self.posts if params["after"] <= p["created_utc"] < params["before"]]}
            return {"data": [{"id": f"p{params['after']}", "title": "Blinkit pet food?", "selftext": "",
                              "author": "u", "created_utc": params["after"] + 10, "permalink": "/r/x/comments/p/"}]}
        if self.fail_comments:
            raise RuntimeError("server overloaded (422)")
        link = params["link_id"]
        return {"data": [{"id": f"{link}-c{i}", "body": f"comment {i}", "author": "v",
                          "created_utc": params["after"] + 20 + i, "link_id": f"t3_{link}",
                          "parent_id": f"t3_{link}", "subreddit": "x"} for i in range(2)]}


def _post(pid: str, title: str, when: datetime, body: str = "") -> dict:
    return {"id": pid, "title": title, "selftext": body, "author": "a", "created_utc": int(when.timestamp()),
            "permalink": f"/r/x/comments/{pid}/"}


# ---------- adaptive search ----------

def test_small_window_needs_one_request():
    http = FakeHttp(overload_days=400)
    posts, frontier = RedditCollector(http=http).search_range("x", "blinkit", START, NOW)
    assert len(posts) == 1 and frontier == NOW and len(http.calls) == 1


def test_overloaded_window_splits_until_it_succeeds():
    http = FakeHttp(overload_days=100)
    c = RedditCollector(http=http)
    posts, frontier = c.search_range("x", "blinkit", START, NOW)
    assert len(posts) == 4 and frontier == NOW and c.failed_windows == 0  # 365 → 182 → ~91-day quarters
    ok = [p for _, p in http.calls if timedelta(seconds=p["before"] - p["after"]) <= timedelta(days=100)]
    assert all(a["before"] == b["after"] for a, b in zip(ok, ok[1:]))  # contiguous, no gaps


def test_frontier_stops_at_first_gap():
    http = FakeHttp(overload_days=1)  # nothing ever succeeds
    c = RedditCollector(http=http)
    posts, frontier = c.search_range("x", "blinkit", START, NOW)
    assert posts == [] and frontier == START and c.failed_windows == 1


# ---------- threads ----------

def test_passing_mention_threads_skip_comment_fetch_and_post_comes_after_comments():
    t = NOW - timedelta(hours=1)
    posts = [_post("on", "Blinkit pet food legit?", t), _post("off", "Street dogs everywhere", t + timedelta(seconds=1),
                                                                   "my blinkit guy got chased")]
    http = FakeHttp(overload_days=400, posts=posts)
    c = RedditCollector(http=http)
    items = raw(c.collect(since=NOW - timedelta(days=2)))
    order = [(i.source, i.source_id) for i in items]
    assert order[:3] == [("reddit_comment", "on-c0"), ("reddit_comment", "on-c1"), ("reddit_post", "on")]
    assert ("reddit_post", "off") in order and ("reddit_comment", "off-c0") not in order
    assert sum(1 for u, _ in http.calls if u == "comments/search") == 1  # once, despite 16 subreddits


def test_known_old_thread_is_not_refetched():
    posts = [_post("old", "Blinkit diapers", NOW - timedelta(days=60))]
    http = FakeHttp(overload_days=400, posts=posts)
    c = RedditCollector(http=http)
    c.known = lambda keys: set(keys)  # pretend everything is already stored
    items = raw(c.collect(since=START))
    assert [i.source_id for i in items] == ["old"] and c.reused_threads == 1
    assert not any(u == "comments/search" for u, _ in http.calls)


def test_failed_thread_caps_frontier_and_post_is_not_stored():
    when = NOW - timedelta(days=30)
    http = FakeHttp(overload_days=400, posts=[_post("p", "Blinkit returns", when)], fail_comments=True)
    c = RedditCollector(http=http)
    out = list(c.collect(since=START))
    assert raw(out) == [] and c.failed_threads >= 1
    # frontier must not pass the failed thread, so the next run finds it again
    assert all(v <= when for v in c.cursor_updates.values())


# ---------- resuming and stopping ----------

def test_resumes_from_saved_frontier():
    frontier = NOW - timedelta(days=20)
    http = FakeHttp(overload_days=400, posts=[])
    c = RedditCollector(http=http)
    c.get_cursor = lambda key: frontier
    out = list(c.collect(since=START))
    assert any(isinstance(o, CursorAdvance) for o in out)
    first_search = next(p for u, p in http.calls if u == "posts/search")
    expected_start = min(frontier - SETTINGS.incremental_overlap,
                         NOW - timedelta(days=SETTINGS.reddit_comment_refresh_days))
    assert abs(first_search["after"] - int(expected_start.timestamp())) <= 2
    assert sub_cursor_key(SETTINGS.subreddits[0]) in c.cursor_updates


def test_stops_early_when_service_is_rate_limiting():
    http = FakeHttp(overload_days=1)  # every search fails
    c = RedditCollector(http=http)
    assert list(c.collect(since=START)) == []
    assert c.stopped_early and c.cursor_updates == {}
    searched_subs = {p["subreddit"] for u, p in http.calls if u == "posts/search"}
    assert len(searched_subs) == STALL_LIMIT  # didn't grind through all 16

from datetime import datetime, timezone

import pytest

from engine.collectors.app_store import parse_entry
from engine.collectors.play_store import parse_review
from engine.collectors.reddit import parse_comment, parse_post
from engine.models import RawItem
from engine.util import hash_author, to_utc


def test_app_store_entry_parsed():
    entry = {
        "author": {"name": {"label": "someone"}},
        "updated": {"label": "2026-11-20T09:15:00-07:00"},
        "im:rating": {"label": "2"},
        "im:version": {"label": "17.1.0"},
        "id": {"label": "12345"},
        "title": {"label": "Never tried pet stuff"},
        "content": {"label": "Not sure the pet food is genuine."},
    }
    item = parse_entry(entry)
    assert item.source == "app_store" and item.source_id == "12345"
    assert item.rating == 2 and item.title == "Never tried pet stuff"
    assert item.posted_at == datetime(2026, 11, 20, 16, 15, tzinfo=timezone.utc)
    assert item.author_hash and "someone" not in item.author_hash


def test_app_store_metadata_entry_skipped():
    assert parse_entry({"id": {"label": "960335206"}, "title": {"label": "Blinkit"}}) is None


def test_play_review_parsed_and_naive_time_converted():
    naive_local = datetime(2026, 11, 21, 15, 38, 48)
    r = {"reviewId": "gp:abc", "userName": "X", "content": "good", "score": 5, "at": naive_local,
         "thumbsUpCount": 3, "reviewCreatedVersion": "16.0", "replyContent": None}
    item = parse_review(r, "en")
    assert item.posted_at.tzinfo is not None
    assert item.posted_at == naive_local.astimezone(timezone.utc)
    assert item.meta["has_company_reply"] is False
    assert "reviewId=gp:abc" in item.url


def test_reddit_post_and_comment():
    post = parse_post({"id": "p1", "title": "Blinkit pet food legit?", "selftext": "[removed]",
                       "author": "u1", "created_utc": 1795300000, "permalink": "/r/bangalore/comments/p1/x/",
                       "subreddit": "bangalore", "score": 4, "num_comments": 2})
    assert post.text == "" and post.title == "Blinkit pet food legit?"
    assert post.url == "https://www.reddit.com/r/bangalore/comments/p1/x/"

    c = parse_comment({"id": "c1", "body": "Bought once, it was fine", "author": "u2",
                       "created_utc": 1795300100, "link_id": "t3_p1", "parent_id": "t3_p1",
                       "subreddit": "bangalore"}, post_title="Blinkit pet food legit?")
    assert c.meta["post_title"] == "Blinkit pet food legit?" and c.meta["is_top_level"]
    assert c.url.startswith("https://www.reddit.com/r/bangalore/comments/p1/")


def test_reddit_skips_deleted_and_automod():
    assert parse_comment({"id": "c", "body": "[deleted]", "author": "x", "created_utc": 1}, None) is None
    assert parse_comment({"id": "c", "body": "hi", "author": "AutoModerator", "created_utc": 1}, None) is None


def test_author_hash_stable_and_anonymous():
    assert hash_author("alice") == hash_author("alice") != hash_author("bob")
    assert hash_author("[deleted]") is None and hash_author(None) is None


def test_to_utc_variants():
    assert to_utc(0) == datetime(1970, 1, 1, tzinfo=timezone.utc)
    assert to_utc("2026-01-01T00:00:00Z") == datetime(2026, 1, 1, tzinfo=timezone.utc)
    # Offsets are normalised to UTC, not just kept aware
    assert to_utc("2026-11-18T10:57:13-07:00").utcoffset().total_seconds() == 0


def test_reddit_term_filter():
    from engine.collectors.reddit import mentions_term

    assert mentions_term("Is diet coke out of stock in Blinkit?")
    assert mentions_term("ordered from BLINKIT back then")
    assert not mentions_term("Street dogs population getting out of hand")
    assert not mentions_term(None)


def test_raw_item_requires_aware_time():
    with pytest.raises(ValueError):
        RawItem(source="x", source_id="1", text="t", posted_at=datetime(2026, 1, 1))

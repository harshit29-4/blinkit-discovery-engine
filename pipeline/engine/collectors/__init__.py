"""Source collectors. Each yields RawItem objects, newest first, down to a `since` boundary."""

from .app_store import AppStoreCollector
from .play_store import PlayStoreCollector
from .reddit import RedditCollector

COLLECTORS = {
    "play_store": PlayStoreCollector,
    "app_store": AppStoreCollector,
    "reddit": RedditCollector,
}

__all__ = ["COLLECTORS", "AppStoreCollector", "PlayStoreCollector", "RedditCollector"]

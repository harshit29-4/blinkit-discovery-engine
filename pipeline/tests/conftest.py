import sys
from pathlib import Path

# Make `import engine` work when pytest runs from the pipeline/ folder.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


import pytest


@pytest.fixture(autouse=True)
def _fast_lane_polling(monkeypatch):
    """Lanes poll for upstream work every 20 s in production; tests poll quickly."""
    from engine.ai import stages

    monkeypatch.setattr(stages, "POLL_S", 0.01)
    monkeypatch.setattr(stages, "SLICE_S", 0.5)
    stages._RUNNING.clear()
    yield
    stages._RUNNING.clear()

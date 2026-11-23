import sys
from pathlib import Path

# Make `import engine` work when pytest runs from the pipeline/ folder.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

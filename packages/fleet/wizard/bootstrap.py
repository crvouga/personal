"""Make `import decide` work without putting scripts/ on sys.path.

scripts/ holds a token.py that would shadow Python's own `token` module for
every import that follows. So decide.py is loaded by file path instead. In a
packaged build decide.py sits beside the other modules and imports normally.
"""
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load():
    if "decide" in sys.modules:
        return sys.modules["decide"]
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    for candidate in (HERE / "decide.py", HERE.parent / "scripts" / "decide.py"):
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("decide", candidate)
            module = importlib.util.module_from_spec(spec)
            sys.modules["decide"] = module
            spec.loader.exec_module(module)
            return module
    import decide  # frozen build: bundled in the archive
    return decide


load()

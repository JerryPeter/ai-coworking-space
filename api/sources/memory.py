"""Per-profile memory files (read-only): <profile>/memories/MEMORY.md and USER.md.

- MEMORY.md = the agent's own notes; USER.md = what the agent knows about the user.
- Content is returned verbatim. Non-UTF-8 bytes are reported as an error, never shown lossily.
- A missing file is `exists: False` (not an error) — e.g. kuririn_dev_lead currently has neither.
- sha256 of the raw bytes lets the UI detect a file cloned byte-for-byte from another profile.
"""
import hashlib
from datetime import datetime, timezone
from pathlib import Path

MEMORY_FILES = {"memory": "MEMORY.md", "user": "USER.md"}
MAX_BYTES = 1024 * 1024  # these files are small (char-budgeted by Hermes); refuse anything absurd


def _result(exists: bool, content=None, error=None, size=None, sha=None, mtime=None) -> dict:
    return {"exists": exists, "content": content, "error": error, "size_bytes": size,
            "sha256": sha, "updated_at": _mtime(mtime) if mtime is not None else None}


def read_memory_file(path: Path) -> dict:
    if not path.is_file():
        return _result(False)
    try:
        st = path.stat()
        if st.st_size > MAX_BYTES:
            return _result(True, error=f"file larger than {MAX_BYTES} bytes; not returned",
                           size=st.st_size, mtime=st.st_mtime)
        data = path.read_bytes()
    except OSError as e:
        return _result(True, error=f"{type(e).__name__}: {e}")
    try:
        text, error = data.decode("utf-8"), None
    except UnicodeDecodeError as e:
        text, error = None, f"not valid UTF-8: {e}"
    return _result(True, text, error, len(data), hashlib.sha256(data).hexdigest(), st.st_mtime)


def read_memories(pdir: Path) -> dict:
    """{'memory': {...}, 'user': {...}} for a resolved profile home."""
    return {key: read_memory_file(pdir / "memories" / fname) for key, fname in MEMORY_FILES.items()}


def _mtime(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

"""Per-profile memory files (read-only): <profile>/memories/MEMORY.md and USER.md.

- MEMORY.md = the agent's own notes; USER.md = what the agent knows about the user.
- Content is returned verbatim. Non-UTF-8 bytes are reported as an error, never shown lossily.
- A missing file is `exists: False` (not an error) — e.g. bagas_dev_lead currently has neither.
"""
from datetime import datetime, timezone
from pathlib import Path

MEMORY_FILES = {"memory": "MEMORY.md", "user": "USER.md"}
MAX_BYTES = 1024 * 1024  # these files are small (char-budgeted by Hermes); refuse anything absurd


def read_memory_file(path: Path) -> dict:
    if not path.is_file():
        return {"exists": False, "content": None, "error": None, "size_bytes": None, "updated_at": None}
    try:
        st = path.stat()
        if st.st_size > MAX_BYTES:
            return {"exists": True, "content": None, "error": f"file larger than {MAX_BYTES} bytes; not returned",
                    "size_bytes": st.st_size, "updated_at": _mtime(st.st_mtime)}
        data = path.read_bytes()
    except OSError as e:
        return {"exists": True, "content": None, "error": f"{type(e).__name__}: {e}", "size_bytes": None, "updated_at": None}
    try:
        text, error = data.decode("utf-8"), None
    except UnicodeDecodeError as e:
        text, error = None, f"not valid UTF-8: {e}"
    return {"exists": True, "content": text, "error": error, "size_bytes": len(data), "updated_at": _mtime(st.st_mtime)}


def read_memories(pdir: Path) -> dict:
    """{'memory': {...}, 'user': {...}} for a resolved profile home."""
    return {key: read_memory_file(pdir / "memories" / fname) for key, fname in MEMORY_FILES.items()}


def _mtime(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

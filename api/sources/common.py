"""Read-only access primitives for ~/.hermes data.

Nothing in app/sources ever writes to HERMES_HOME:
- SQLite is opened with a `mode=ro` URI plus `PRAGMA query_only=ON` (WAL-safe readers; a
  busy timeout handles lock contention with the live Hermes processes).
- Files are only ever opened for reading.
"""
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException

from api import config

PROFILE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def hermes_home() -> Path:
    return config.HERMES_HOME


def profiles_root() -> Path:
    return hermes_home() / "profiles"


def list_profiles() -> list[str]:
    """Profile directories under ~/.hermes/profiles (each one is an "agent"), plus the
    synthetic "default" profile whose home is ~/.hermes itself (the un-named default
    Hermes profile predates the profiles/ convention and lives at the top level).

    Edge case: if a real ~/.hermes/profiles/default/ directory ever exists on disk, that
    real directory wins and "default" is NOT synthesized here (it is already included by
    the iterdir() below) — we never silently merge the two into one entry.
    """
    root = profiles_root()
    names = sorted(p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")) if root.is_dir() else []
    if "default" not in names:
        names = sorted(names + ["default"])
    return names


def resolve_profile_home(name: str) -> Path:
    """Resolve a profile name to its home directory.

    "default" is special: unless a real profiles/default/ dir exists (edge case, see
    list_profiles()), it resolves to hermes_home() itself rather than profiles/default/,
    since the default Hermes profile's data (state.db, cron/, memories/, gateway.lock,
    profile.yaml) lives directly at the top level of HERMES_HOME.
    """
    if name == "default" and not (profiles_root() / "default").is_dir():
        return hermes_home()
    return profiles_root() / name


def profile_home_label(name: str) -> str:
    """Human-readable home of a profile for API `source` strings: "~/.hermes" for the
    synthetic default profile, "~/.hermes/profiles/<name>" otherwise (incl. a real
    profiles/default/ dir). Mirrors resolve_profile_home()."""
    if resolve_profile_home(name) == hermes_home():
        return "~/.hermes"
    return f"~/.hermes/profiles/{name}"


def profile_dir(name: str) -> Path:
    """Resolve a profile dir, or 404. The name regex makes path traversal impossible."""
    if not PROFILE_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="invalid profile name")
    p = resolve_profile_home(name)
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"profile {name!r} not found")
    return p


@contextmanager
def ro_connect(path: Path):
    """Read-only SQLite connection. Raises FileNotFoundError if the DB does not exist
    (mode=ro never creates a file, but we check first for a clean error)."""
    if not path.is_file():
        raise FileNotFoundError(str(path))
    uri = "file:" + quote(str(path.resolve())) + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5.0)
    try:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA query_only = ON")
        yield con
    finally:
        con.close()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def epoch_to_iso(v) -> str | None:
    if v is None:
        return None
    try:
        return datetime.fromtimestamp(float(v), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def parse_iso(v) -> datetime | None:
    """Parse an ISO-8601 timestamp; naive values are treated as UTC. None if unparseable."""
    if not v or not isinstance(v, str):
        return None
    try:
        d = datetime.fromisoformat(v)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

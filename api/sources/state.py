"""Per-profile session/activity data: <profile>/state.db, tables `sessions` + `messages` (read-only)."""
import sqlite3
from pathlib import Path

from api.sources.common import epoch_to_iso, now_utc, resolve_profile_home, ro_connect


def state_db(profile: str) -> Path:
    return resolve_profile_home(profile) / "state.db"


def sessions_started_since(profile: str, hours: float) -> int | None:
    """Count of sessions whose started_at (unix epoch REAL) is within the last `hours`."""
    since = now_utc().timestamp() - hours * 3600
    try:
        with ro_connect(state_db(profile)) as con:
            return con.execute("SELECT COUNT(*) FROM sessions WHERE started_at >= ?", (since,)).fetchone()[0]
    except (FileNotFoundError, sqlite3.Error):
        return None


# messages_in_db is counted from the messages table itself, as a cross-check on the
# denormalised sessions.message_count.
_SESSIONS_SQL = (
    "SELECT s.id, s.source, s.model, s.title, s.display_name, s.started_at, s.ended_at, s.end_reason, "
    "s.last_activity_at, s.last_activity_description, s.message_count, s.tool_call_count, "
    "s.input_tokens, s.output_tokens, s.estimated_cost_usd, s.actual_cost_usd, s.parent_session_id, "
    "s.archived, s.hidden, "
    "(SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS messages_in_db "
    "FROM sessions s ORDER BY s.started_at DESC LIMIT ?"
)


_LATEST_SQL = (
    "SELECT id, title, last_activity_at, last_activity_description, ended_at, end_reason FROM sessions "
    "WHERE last_activity_at IS NOT NULL ORDER BY last_activity_at DESC LIMIT 1"
)


def latest_activity(profile: str) -> dict:
    """The profile's most recently active session (by last_activity_at), for the office view.
    {'available', 'session' (dict|None), 'error'}. An empty last_activity_description ("" in
    state.db) is normalised to None — it means "not recorded", not "did nothing"."""
    try:
        with ro_connect(state_db(profile)) as con:
            row = con.execute(_LATEST_SQL).fetchone()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "session": None, "error": f"{type(e).__name__}: {e}"}
    if row is None:
        return {"available": True, "session": None, "error": None}
    s = dict(row)
    s["last_activity_description"] = s["last_activity_description"] or None
    s["last_activity_at_iso"] = epoch_to_iso(s["last_activity_at"])
    s["ended_at_iso"] = epoch_to_iso(s["ended_at"])
    return {"available": True, "session": s, "error": None}


def recent_sessions(profile: str, limit: int) -> dict:
    try:
        with ro_connect(state_db(profile)) as con:
            total = con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            rows = con.execute(_SESSIONS_SQL, (limit,)).fetchall()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "total": None, "sessions": [], "error": f"{type(e).__name__}: {e}"}
    return {"available": True, "total": total, "error": None,
            "sessions": [{"profile": profile, **dict(r),
                          "started_at_iso": epoch_to_iso(r["started_at"]),
                          "ended_at_iso": epoch_to_iso(r["ended_at"]),
                          "last_activity_at_iso": epoch_to_iso(r["last_activity_at"])} for r in rows]}

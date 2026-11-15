"""Global kanban board: ~/.hermes/kanban.db, table `tasks` (read-only)."""
import sqlite3

from api.sources.common import hermes_home, ro_connect

# Hermes' default workflow columns, in dashboard order, plus the `archived` filter status.
# Source: ~/.hermes/hermes-agent/hermes_cli/kanban_workflow.py (DEFAULT_WORKFLOW / DEFAULT_STATUSES).
DEFAULT_COLUMNS = [
    ("triage", "Triage"), ("todo", "Todo"), ("scheduled", "Scheduled"), ("ready", "Ready"),
    ("running", "Running"), ("blocked", "Blocked"), ("review", "Review"), ("done", "Done"),
    ("archived", "Archived"),
]


def db_path():
    return hermes_home() / "kanban.db"


def counts() -> dict:
    """{'available', 'total', 'by_status', 'error'}; counts are None if the DB can't be read."""
    try:
        with ro_connect(db_path()) as con:
            total = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            rows = con.execute("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").fetchall()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "total": None, "by_status": None, "error": f"{type(e).__name__}: {e}"}
    found = {r["status"]: r["n"] for r in rows}
    # Zero-fill the real Hermes statuses (a 0 here is a true count), then keep any extra
    # status values actually present in the DB so nothing is hidden.
    by_status = {key: found.pop(key, 0) for key, _ in DEFAULT_COLUMNS}
    by_status.update(found)
    return {"available": True, "total": total, "by_status": by_status, "error": None}


TASK_LIST_LIMIT = 2000

# Claimed = the two statuses the office treats as "this agent has a task in hand".
CLAIMED_STATUSES = ("running", "review")
_CLAIMED_SQL = (
    "SELECT id, title, assignee, status, priority, started_at, created_at FROM tasks "
    "WHERE status IN (?, ?) AND assignee IS NOT NULL "
    "ORDER BY priority DESC, started_at DESC, created_at DESC"
)


def claimed_tasks() -> dict:
    """Every Running/Review task with an assignee (targeted query: never truncated).
    {'available', 'tasks' (list|None), 'total' (all tasks), 'error'}."""
    try:
        with ro_connect(db_path()) as con:
            total = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            rows = con.execute(_CLAIMED_SQL, CLAIMED_STATUSES).fetchall()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "tasks": None, "total": None, "error": f"{type(e).__name__}: {e}"}
    return {"available": True, "tasks": [dict(r) for r in rows], "total": total, "error": None}

_TASKS_SQL = (
    "SELECT id, title, assignee, status, priority, created_by, created_at, started_at, "
    "completed_at, tenant, consecutive_failures FROM tasks "
    "ORDER BY priority DESC, created_at DESC LIMIT ?"
)


def tasks() -> dict:
    """All tasks (up to TASK_LIST_LIMIT, newest first) grouped into board columns."""
    try:
        with ro_connect(db_path()) as con:
            total = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            rows = con.execute(_TASKS_SQL, (TASK_LIST_LIMIT,)).fetchall()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "total": None, "columns": None, "tasks": None,
                "truncated": False, "error": f"{type(e).__name__}: {e}"}
    items = [dict(r) for r in rows]
    known = [k for k, _ in DEFAULT_COLUMNS]
    extra = sorted({t["status"] for t in items} - set(known))  # never drop unexpected statuses
    columns = [{"status": k, "label": label, "tasks": [t for t in items if t["status"] == k]}
               for k, label in DEFAULT_COLUMNS + [(s, s) for s in extra]]
    for c in columns:
        c["count"] = len(c["tasks"])
    return {"available": True, "total": total, "columns": columns, "tasks": items,
            "truncated": total > len(items), "error": None}

"""Per-profile cron data (read-only).

- Job definitions: <profile>/cron/jobs.json — Hermes' job store (hermes-agent/cron/jobs.py:
  "Cron job storage: <HERMES_HOME>/cron/jobs.json"). A missing file means the profile has no
  configured jobs; that is reported as 0 jobs with jobs_file_present=False.
- Run history: <profile>/cron/executions.db, table `executions`.
  status ∈ claimed|running|completed|failed|unknown|cancelled|missed (CHECK constraint).
  A "failure" is status='failed'. claimed_at is an ISO-8601 string with tz offset.
"""
import json
import sqlite3
from datetime import timedelta
from pathlib import Path

from api.sources.common import now_utc, parse_iso, resolve_profile_home, ro_connect

RECENT_FAILURE_WINDOW_HOURS = 24 * 7


def jobs_file(profile: str) -> Path:
    return resolve_profile_home(profile) / "cron" / "jobs.json"


def executions_db(profile: str) -> Path:
    return resolve_profile_home(profile) / "cron" / "executions.db"


def load_jobs(profile: str) -> dict:
    """{'jobs_file_present', 'jobs' (list|None), 'error'}."""
    f = jobs_file(profile)
    if not f.is_file():
        return {"jobs_file_present": False, "jobs": [], "error": None}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {"jobs_file_present": True, "jobs": None, "error": f"{type(e).__name__}: {e}"}
    raw = data.get("jobs", []) if isinstance(data, dict) else data
    if isinstance(raw, dict):  # keyed-by-id variant also accepted by Hermes
        raw = [{**v, "id": v.get("id") or k} for k, v in raw.items() if isinstance(v, dict)]
    if not isinstance(raw, list):
        return {"jobs_file_present": True, "jobs": None, "error": "unrecognised jobs.json shape"}
    return {"jobs_file_present": True, "jobs": [j for j in raw if isinstance(j, dict)], "error": None}


def run_stats(profile: str) -> dict:
    """Totals from executions.db. Values are None when the DB is missing/unreadable."""
    try:
        with ro_connect(executions_db(profile)) as con:
            total = con.execute("SELECT COUNT(*) FROM executions").fetchone()[0]
            failed_rows = con.execute(
                "SELECT claimed_at, finished_at FROM executions WHERE status = ?", ("failed",)
            ).fetchall()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "runs_total": None, "failed_total": None,
                "recent_failures": None, "error": f"{type(e).__name__}: {e}"}
    cutoff = now_utc() - timedelta(hours=RECENT_FAILURE_WINDOW_HOURS)
    recent = 0
    for r in failed_rows:
        # ISO strings with mixed offsets don't compare correctly as text, so compare parsed.
        ts = parse_iso(r["finished_at"]) or parse_iso(r["claimed_at"])
        if ts is not None and ts >= cutoff:
            recent += 1
    return {"available": True, "runs_total": total, "failed_total": len(failed_rows),
            "recent_failures": recent, "error": None}


_RUNS_SQL = (
    "SELECT id, job_id, source, status, claimed_at, started_at, finished_at, error, "
    "delivery_outcome, scheduled_instant FROM executions "
    "ORDER BY claimed_at DESC, id DESC LIMIT ?"  # matches Hermes' own index order
)


def runs(profile: str, limit: int) -> dict:
    try:
        with ro_connect(executions_db(profile)) as con:
            total = con.execute("SELECT COUNT(*) FROM executions").fetchone()[0]
            rows = con.execute(_RUNS_SQL, (limit,)).fetchall()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"available": False, "total": None, "runs": [], "error": f"{type(e).__name__}: {e}"}
    return {"available": True, "total": total, "runs": [{"profile": profile, **dict(r)} for r in rows], "error": None}

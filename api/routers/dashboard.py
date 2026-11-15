from fastapi import APIRouter

from api.sources import cron, kanban, state
from api.sources.common import list_profiles, now_utc

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _sum(values: list) -> int | None:
    """Sum of known values; None if nothing could be determined (never a guessed 0)."""
    known = [v for v in values if v is not None]
    return sum(known) if known else None


@router.get("/summary")
def summary() -> dict:
    profiles = list_profiles()

    job_counts, runs, failed, recent, cron_unreadable = [], [], [], [], []
    sessions_24h, state_unreadable = [], []
    for p in profiles:
        jobs = cron.load_jobs(p)["jobs"]
        job_counts.append(len(jobs) if jobs is not None else None)
        rs = cron.run_stats(p)
        if not rs["available"]:
            cron_unreadable.append(p)
        runs.append(rs["runs_total"])
        failed.append(rs["failed_total"])
        recent.append(rs["recent_failures"])
        n = state.sessions_started_since(p, 24)
        if n is None:
            state_unreadable.append(p)
        sessions_24h.append(n)

    k = kanban.counts()
    return {
        "agents": {"total": len(profiles), "source": "~/.hermes/profiles/* directories and ~/.hermes (default profile)"},
        "kanban": {"total": k["total"], "by_status": k["by_status"], "available": k["available"],
                   "error": k["error"], "source": "~/.hermes/kanban.db: tasks"},
        "cron": {
            "jobs": _sum(job_counts),
            "runs_total": _sum(runs),
            "failed_total": _sum(failed),
            "recent_failures": _sum(recent),
            "recent_failures_window_hours": cron.RECENT_FAILURE_WINDOW_HOURS,
            "failure_definition": "executions.status = 'failed'",
            "unreadable_profiles": cron_unreadable,
            "source": "profiles/*/cron/ and ~/.hermes/cron/ (default profile): jobs.json (jobs), executions.db: executions (runs)",
        },
        "activity": {
            "sessions_24h": _sum(sessions_24h),
            "definition": "sessions with started_at in the last 24h",
            "unreadable_profiles": state_unreadable,
            "source": "profiles/*/state.db and ~/.hermes/state.db (default profile): sessions",
        },
        "generated_at": now_utc().isoformat(),
    }

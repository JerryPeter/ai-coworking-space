from fastapi import APIRouter, Query

from api.sources import cron
from api.sources.common import list_profiles

router = APIRouter(prefix="/cron", tags=["cron"])


@router.get("/jobs")
def list_jobs() -> dict:
    """Configured cron jobs per profile, from <profile>/cron/jobs.json (Hermes' job store).
    A profile with no jobs.json has zero configured jobs (that is what Hermes itself assumes)."""
    jobs, per_profile = [], []
    for p in list_profiles():
        d = cron.load_jobs(p)
        per_profile.append({"profile": p, "jobs_file_present": d["jobs_file_present"],
                            "count": len(d["jobs"]) if d["jobs"] is not None else None, "error": d["error"]})
        for j in d["jobs"] or []:
            jobs.append({"profile": p, **j})
    return {"jobs": jobs, "count": len(jobs), "profiles": per_profile,
            "source": "~/.hermes/profiles/*/cron/jobs.json and ~/.hermes/cron/jobs.json (default profile)"}


@router.get("/runs")
def list_runs(limit: int = Query(200, ge=1, le=5000)) -> dict:
    """Cron run history per profile from <profile>/cron/executions.db (table `executions`)."""
    runs, per_profile = [], []
    for p in list_profiles():
        d = cron.runs(p, limit)
        per_profile.append({"profile": p, "available": d["available"], "total": d["total"], "error": d["error"]})
        runs.extend(d["runs"])
    known = [x["total"] for x in per_profile if x["total"] is not None]
    return {
        "runs": runs,
        "count": sum(known) if known else None,  # total rows in executions (all profiles)
        "returned": len(runs),
        "limit_per_profile": limit,
        "profiles": per_profile,
        "source": "~/.hermes/profiles/*/cron/executions.db and ~/.hermes/cron/executions.db (default profile): executions",
    }

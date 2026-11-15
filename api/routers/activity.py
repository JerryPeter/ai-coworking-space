from fastapi import APIRouter, Query

from api.sources import state
from api.sources.common import list_profiles

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("/sessions")
def list_sessions(limit: int = Query(50, ge=1, le=1000)) -> dict:
    """Most recent sessions across profiles (newest first) from <profile>/state.db."""
    sessions, per_profile = [], []
    for p in list_profiles():
        d = state.recent_sessions(p, limit)
        per_profile.append({"profile": p, "available": d["available"], "total": d["total"], "error": d["error"]})
        sessions.extend(d["sessions"])
    sessions.sort(key=lambda s: s["started_at"] or 0, reverse=True)
    sessions = sessions[:limit]
    known = [x["total"] for x in per_profile if x["total"] is not None]
    return {
        "sessions": sessions,
        "count": len(sessions),                       # entries returned
        "total": sum(known) if known else None,       # all sessions in state.db(s)
        "limit": limit,
        "profiles": per_profile,
        "source": "~/.hermes/profiles/*/state.db and ~/.hermes/state.db (default profile): sessions (+ messages for messages_in_db)",
    }

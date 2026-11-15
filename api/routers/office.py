from fastapi import APIRouter

from api.sources.office import office_state

router = APIRouter(prefix="/office", tags=["office"])


@router.get("/state")
def get_office_state() -> dict:
    """Per-agent state for the 3D office scene, composed server-side (see sources/office.py)."""
    return {
        **office_state(),
        "source": "gateway.lock + /proc (gateway), ~/.hermes/kanban.db: tasks (claims), "
                  "<profile>/state.db: sessions (last activity), "
                  "<profile>/runtime/active_sessions.json (leases, info only), /proc/*/cmdline (Claude Code CLI)",
    }

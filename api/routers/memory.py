from fastapi import APIRouter

from api.routers._common import ProfileName
from api.sources.common import profile_dir, profile_home_label
from api.sources.memory import read_memories

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/{profile}")
def get_memory(profile: str = ProfileName) -> dict:
    """Verbatim <profile>/memories/MEMORY.md and USER.md (read-only)."""
    home = profile_home_label(profile)
    files = read_memories(profile_dir(profile))
    return {
        "profile": profile,
        "memory": {**files["memory"], "source": f"{home}/memories/MEMORY.md"},
        "user": {**files["user"], "source": f"{home}/memories/USER.md"},
    }

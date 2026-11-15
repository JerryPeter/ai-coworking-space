from fastapi import APIRouter

from api.routers._common import ProfileName
from api.sources.common import profile_dir, profile_home_label, resolve_profile_home
from api.sources.memory import read_memories

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/{profile}")
def get_memory(profile: str = ProfileName) -> dict:
    """Verbatim <profile>/memories/MEMORY.md and USER.md (read-only), plus whether each file is
    byte-identical to the default profile's (the "cloned from default" badge in the design spec)."""
    home = profile_home_label(profile)
    files = read_memories(profile_dir(profile))
    is_default = resolve_profile_home(profile) == resolve_profile_home("default")
    defaults = None if is_default else read_memories(resolve_profile_home("default"))
    out = {"profile": profile}
    for key, fname in (("memory", "MEMORY.md"), ("user", "USER.md")):
        f = files[key]
        if is_default or not f["sha256"]:
            same = None  # not applicable (this is default) or nothing to compare
        else:
            d = defaults[key]["sha256"]
            same = None if d is None else f["sha256"] == d
        out[key] = {**f, "identical_to_default": same, "source": f"{home}/memories/{fname}"}
    return out

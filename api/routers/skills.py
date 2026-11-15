from fastapi import APIRouter

from api.routers._common import ProfileName
from api.sources.common import profile_dir, profile_home_label
from api.sources.skills import list_skills as _list_skills

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("/{profile}")
def list_skills(profile: str = ProfileName) -> dict:
    d = _list_skills(profile_dir(profile))
    return {
        "profile": profile,
        "skills": d["skills"],
        "count": len(d["skills"]),
        "skills_dir_present": d["skills_dir_present"],
        "definition": "a directory under skills/ (excluding dot-dirs) that directly contains SKILL.md",
        "source": f"{profile_home_label(profile)}/skills/",
    }

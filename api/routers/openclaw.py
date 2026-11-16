from fastapi import APIRouter, HTTPException, Path
from api.sources.openclaw import SOURCE, openclaw_agent_info, openclaw_agents

router = APIRouter(prefix="/openclaw", tags=["openclaw"])


@router.get("/agents")
def list_agents() -> dict:
    d = openclaw_agents()
    return {**d, "count": len(d["agents"]), "source": SOURCE}


@router.get("/agents/{name}")
def get_agent(name: str = Path(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")) -> dict:
    info = openclaw_agent_info(name)
    if info is None:
        raise HTTPException(status_code=404, detail=f"openclaw team agent {name!r} not found")
    return {"agent": info, "source": SOURCE}

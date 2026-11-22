from fastapi import APIRouter, Query

from api.sources.usage import get_usage_summary

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/summary")
def usage_summary(days: int = Query(30, ge=1, le=365)) -> dict:
    """Hermes token/cost usage across all profiles (auth enforced by the /api router)."""
    return get_usage_summary(days)

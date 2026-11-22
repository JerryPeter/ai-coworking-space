import time

from fastapi import APIRouter, Query

from api.sources.usage import get_limits, get_usage_summary

router = APIRouter(prefix="/usage", tags=["usage"])

_LIMITS_TTL_S = 60  # hermes usage --json shells out; avoid hitting it on every poll
_limits_cache: dict | None = None
_limits_cache_at = 0.0


@router.get("/summary")
def usage_summary(days: int = Query(30, ge=1, le=365)) -> dict:
    """Hermes token/cost usage across all profiles (auth enforced by the /api router)."""
    return get_usage_summary(days)


@router.get("/limits")
def usage_limits() -> dict:
    """Claude (Anthropic) + OpenCode account rate limits (auth enforced by the /api router).
    Cached for 60s in a module-level variable since this shells out to `hermes usage --json`."""
    global _limits_cache, _limits_cache_at
    now = time.monotonic()
    if _limits_cache is None or now - _limits_cache_at >= _LIMITS_TTL_S:
        _limits_cache = get_limits()
        _limits_cache_at = now
    return _limits_cache

"""Mission Control V2 — FastAPI application entry point (scaffold)."""
from fastapi import APIRouter, Depends, FastAPI

from api import config  # noqa: F401  (fail fast if .env is misconfigured)
from api.middleware import setup_middleware
from api.security import require_token

app = FastAPI(title="Mission Control V2", version="0.1.0")
setup_middleware(app)

# Every /api/* route hangs off this router, so auth is enforced in one place.
api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])
app.include_router(api)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}

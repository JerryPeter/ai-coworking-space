"""Mission Control V2 — FastAPI application entry point."""
from fastapi import APIRouter, Depends, FastAPI
from fastapi.staticfiles import StaticFiles

from api import config  # noqa: F401  (fail fast if .env is misconfigured)
from api.middleware import setup_middleware
from api.routers import activity, agents, cron, dashboard, kanban, memory, office, skills
from api.security import require_token

app = FastAPI(title="Mission Control V2", version="0.1.0")
setup_middleware(app)

# Every /api/* route hangs off this router, so auth is enforced in one place.
api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])
for module in (dashboard, agents, kanban, cron, activity, memory, skills, office):
    api.include_router(module.router)
app.include_router(api)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Production frontend (npm run build -> dist/). Mounted last so it never shadows /health or
# /api/*; skipped when the frontend hasn't been built (API-only mode).
if (config.FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")

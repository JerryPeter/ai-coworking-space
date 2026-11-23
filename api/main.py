"""Mission Control V2 — FastAPI application entry point."""
from fastapi import APIRouter, Depends, FastAPI
from fastapi.staticfiles import StaticFiles

from api import config  # noqa: F401  (fail fast if .env is misconfigured)
from api.middleware import setup_middleware
from api.routers import activity, agents, cron, dashboard, graphify, kanban, memory, office, openclaw, skills, usage
from api.security import require_token

app = FastAPI(title="Mission Control V2", version="0.1.0")
setup_middleware(app)

# Every /api/* route hangs off this router, so auth is enforced in one place.
api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])
for module in (dashboard, agents, kanban, cron, activity, memory, skills, office, openclaw, usage, graphify):
    api.include_router(module.router)
app.include_router(api)


@app.middleware("http")
async def frontend_cache_headers(request, call_next):
    """index.html (and SPA routes) must always be revalidated, otherwise a browser keeps an
    old bundle after a rebuild (e.g. a profile rename leaves avatars blank). Hashed files
    under /assets/ never change content, so they can be cached forever."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not path.startswith("/api/") and path != "/health":
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Production frontend (npm run build -> dist/). Mounted last so it never shadows /health or
# /api/*; skipped when the frontend hasn't been built (API-only mode).
if (config.FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")

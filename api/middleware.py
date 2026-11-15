"""CORS + request logging middleware."""
import logging
import sys
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api import config

logger = logging.getLogger("mission_control_v2.access")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def setup_middleware(app: FastAPI) -> None:
    # Local single-user app: only the app's own origin and the Vite dev server. (In dev the Vite
    # proxy makes requests same-origin anyway; the :5173 entries only matter if a page calls
    # :8742 directly.) Read-only API -> GET only.
    origins = {
        f"http://{config.BIND_HOST}:{config.BIND_PORT}",
        f"http://localhost:{config.BIND_PORT}",
        f"http://127.0.0.1:{config.VITE_DEV_PORT}",
        f"http://localhost:{config.VITE_DEV_PORT}",
    }
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.info(
                "method=%s path=%s status=%d duration_ms=%.1f",
                request.method, request.url.path, status_code, duration_ms,
            )

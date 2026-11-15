#!/usr/bin/env bash
# Production-style start: FastAPI serves /api/*, /health and (if built) the frontend from dist/.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env missing (copy .env.example, set a token, chmod 600)"; exit 1; }
set -a; . ./.env; set +a
if [ "${BIND_HOST}" != "127.0.0.1" ]; then echo "refusing: BIND_HOST must be 127.0.0.1"; exit 1; fi
echo "Mission Control V2 @ $(git rev-parse --short HEAD 2>/dev/null || echo no-git) on http://${BIND_HOST}:${BIND_PORT}"
if [ -f dist/index.html ]; then
  echo "frontend: dist/ (built $(date -r dist/index.html '+%F %T'))"
else
  echo "frontend: not built (run: npm run build) - serving API only"
fi
exec .venv/bin/uvicorn api.main:app --host "${BIND_HOST}" --port "${BIND_PORT}"

#!/usr/bin/env bash
# Dev: API (uvicorn --reload on :BIND_PORT) + Vite dev server (:5173, proxies /api) in parallel.
# Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env missing (copy .env.example, set a token, chmod 600)"; exit 1; }
set -a; . ./.env; set +a
if [ "${BIND_HOST}" != "127.0.0.1" ]; then echo "refusing: BIND_HOST must be 127.0.0.1"; exit 1; fi
.venv/bin/uvicorn api.main:app --host "${BIND_HOST}" --port "${BIND_PORT}" --reload --reload-dir api &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM
# Low-RAM host (no swap): cap the Node heap so Vite can't starve other processes.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" ./node_modules/.bin/vite

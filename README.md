# Mission Control V2

Local, read-only dashboard for the Hermes agent team (default/Hawa, pratama_cto,
bagas_dev_lead, susi_uiux) with a Three.js "office" view. Successor to ~/mission-control (v1).

- Backend: FastAPI (Python venv) in `api/`. Reads ~/.hermes strictly read-only
  (SQLite `mode=ro` + `PRAGMA query_only`, files opened for reading only).
- Frontend: Vite + React + TypeScript + Three.js (@react-three/fiber) in `src/` (stub for now).
- One port in production: 8742 serves `/health`, `/api/*` and the built frontend (`dist/`).
- Every `/api/*` route requires `Authorization: Bearer <MISSION_CONTROL_V2_API_TOKEN>`.
- Binds to 127.0.0.1 only (config refuses anything else).

API reference for frontend work: [API_CONTRACT.md](API_CONTRACT.md).

## Setup

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    NODE_OPTIONS=--max-old-space-size=512 npm ci --no-audit --no-fund
    cp .env.example .env && chmod 600 .env   # then set MISSION_CONTROL_V2_API_TOKEN
    # token: .venv/bin/python -c "import secrets; print(secrets.token_urlsafe(32))"

## Run

    ./start.sh     # production: API + dist/ on http://127.0.0.1:8742
    ./dev.sh       # dev: API on :8742 (--reload) + Vite on http://127.0.0.1:5173 (proxies /api)
    npm run build  # typecheck + build frontend into dist/

## Check

    curl -s http://127.0.0.1:8742/health
    curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8742/api/office/state

`tools/sqlq.py DB 'SQL'` is a read-only SQLite helper (no sqlite3 binary on this host).

## Host note

This machine has ~4 GB RAM and no swap. Keep Node capped
(`NODE_OPTIONS=--max-old-space-size=512`) for installs, builds and the dev server.

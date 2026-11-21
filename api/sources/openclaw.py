"""OpenClaw team agents (read-only). Spec: docs/sync-fix-and-openclaw-plan.md section 2.

Inputs, all read-only (never written, no CLI calls, no calls to the gateway HTTP port):
  - team list + identity   ~/.openclaw/openclaw.json: agents.entries, agents.defaults.model ONLY
  - gateway liveness       ~/.openclaw/state/openclaw.sqlite: state_leases (scope='gateway-owner')
                           + /proc/<pid>/stat starttime (same check as profiles.py for Hermes)
  - last run               ~/.openclaw/state/openclaw.sqlite: audit_events (kind='agent_run')
  - session count          ~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite: session_windows

SECURITY: these files hold live secrets (gateway token, Telegram bot token, provider keys, a push
private key). Every read uses an explicit column/key allowlist: never SELECT *, never return a
config object whole, never read transcript text or session_key values.

The `openclaw` agent directory is OpenClaw's built-in system agent: it has no agents.entries row
and is never exposed here.
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from api import config
from api.sources.common import now_utc, ro_connect
from api.sources.profiles import _proc_starttime

PROC = Path("/proc")
SYSTEM_AGENTS = {"openclaw"}
SOURCE = "~/.openclaw/openclaw.json + ~/.openclaw/state/openclaw.sqlite"

# Allowlisted SQL. Only scalar, non-secret columns; payload_json is reduced to 2 keys inside SQLite.
_LEASE_SQL = ("SELECT json_extract(payload_json, '$.owner.pid') AS pid, "
              "json_extract(payload_json, '$.owner.startedAt') AS started_at, expires_at "
              "FROM state_leases WHERE scope = 'gateway-owner' ORDER BY heartbeat_at DESC LIMIT 1")
_LAST_RUN_SQL = ("SELECT MAX(occurred_at) FROM audit_events "
                 "WHERE kind = 'agent_run' AND agent_id = ?")
_SESSION_COUNT_SQL = "SELECT COUNT(session_id) FROM session_windows"


def _home() -> Path:
    return config.OPENCLAW_HOME


def _state_db() -> Path:
    return _home() / "state" / "openclaw.sqlite"


def _agent_db(name: str) -> Path:
    return _home() / "agents" / name / "agent" / "openclaw-agent.sqlite"


def _agents_config() -> tuple[dict, str | None]:
    """{'entries': {...}, 'default_model': str|None} from openclaw.json; only the `agents` key is
    kept, everything else (tokens etc.) is dropped immediately after parsing."""
    try:
        data = json.loads((_home() / "openclaw.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {"entries": {}, "default_model": None}, f"openclaw.json unreadable: {type(e).__name__}"
    agents = data.get("agents") if isinstance(data, dict) else None
    del data
    if not isinstance(agents, dict) or not isinstance(agents.get("entries"), dict):
        return {"entries": {}, "default_model": None}, "openclaw.json has no agents.entries"
    defaults = agents.get("defaults") if isinstance(agents.get("defaults"), dict) else {}
    dm = defaults.get("model")
    if isinstance(dm, dict):
        dm = dm.get("primary")
    return {"entries": agents["entries"], "default_model": dm if isinstance(dm, str) else None}, None


def list_openclaw_agents() -> list[str]:
    """Team agent ids in config order, excluding the built-in system agent."""
    cfg, _ = _agents_config()
    return [k for k, v in cfg["entries"].items() if k not in SYSTEM_AGENTS and isinstance(v, dict)]


def openclaw_gateway_detail() -> dict:
    """{'status': running|stopped|unknown, 'detail': str}.
    running: lease row, pid alive, /proc starttime == owner.startedAt, lease not expired."""
    try:
        with ro_connect(_state_db()) as con:
            row = con.execute(_LEASE_SQL).fetchone()
    except (FileNotFoundError, sqlite3.Error) as e:
        return {"status": "unknown", "detail": f"openclaw.sqlite unreadable: {type(e).__name__}"}
    if row is None:
        return {"status": "unknown", "detail": "no gateway-owner lease row"}
    try:
        pid, start = int(row["pid"]), int(row["started_at"])
    except (TypeError, ValueError):
        return {"status": "unknown", "detail": "gateway-owner lease has no usable pid/startedAt"}
    if not PROC.is_dir():
        return {"status": "unknown", "detail": "/proc not available; cannot check pid"}
    try:
        actual = _proc_starttime(pid)
    except FileNotFoundError:
        return {"status": "stopped", "detail": f"gateway pid {pid} is not alive (stale lease)"}
    except (OSError, ValueError, IndexError) as e:
        return {"status": "unknown", "detail": f"could not read /proc/{pid}/stat: {type(e).__name__}"}
    if actual != start:
        return {"status": "stopped", "detail": f"pid {pid} alive but starttime {actual} != lease {start} (pid reused)"}
    exp = row["expires_at"]
    if isinstance(exp, (int, float)) and exp / 1000 < now_utc().timestamp():
        return {"status": "stopped", "detail": f"gateway pid {pid} alive but lease expired (no heartbeat)"}
    return {"status": "running", "detail": f"gateway pid {pid} alive; /proc starttime matches lease; lease fresh"}


def openclaw_gateway_status() -> str:
    return openclaw_gateway_detail()["status"]


def _ms_to_iso(v) -> str | None:
    if not isinstance(v, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _model_label(entry: dict, default_model: str | None) -> tuple[str | None, bool]:
    """(model, inherited). Strips the provider prefix and any @<auth-profile> suffix:
    'openrouter/~openai/gpt-luna-latest@openrouter:setup-..' -> '~openai/gpt-luna-latest'."""
    m = entry.get("model")
    m = m.get("primary") if isinstance(m, dict) else m
    inherited = not isinstance(m, str)
    if inherited:
        m = default_model
    if not isinstance(m, str):
        return None, inherited
    m = m.split("@", 1)[0]
    return (m.split("/", 1)[1] if "/" in m else m), inherited


def _last_run_at(name: str) -> tuple[str | None, str | None]:
    try:
        with ro_connect(_state_db()) as con:
            v = con.execute(_LAST_RUN_SQL, (name,)).fetchone()[0]
    except (FileNotFoundError, sqlite3.Error) as e:
        return None, f"audit_events unreadable: {type(e).__name__}"
    return _ms_to_iso(v), None


def _session_count(name: str) -> int:
    try:
        with ro_connect(_agent_db(name)) as con:
            return int(con.execute(_SESSION_COUNT_SQL).fetchone()[0])
    except (FileNotFoundError, sqlite3.Error):
        return 0


def openclaw_agent_info(name: str, gateway: str | None = None, cfg: dict | None = None) -> dict | None:
    """One team agent's allowlisted info, or None if `name` is not a team agent."""
    if cfg is None:
        cfg, _ = _agents_config()
    entry = cfg["entries"].get(name)
    if name in SYSTEM_AGENTS or not isinstance(entry, dict):
        return None
    ident = entry.get("identity") if isinstance(entry.get("identity"), dict) else {}
    model, inherited = _model_label(entry, cfg["default_model"])
    last_run, err = _last_run_at(name)
    allow = (entry.get("subagents") or {}).get("allowAgents") if isinstance(entry.get("subagents"), dict) else None
    ident_name = ident.get("name")
    # Short label: first word of the identity name ("Greg Graffin" -> "Greg"); blank -> agent id.
    first_word = ident_name.split()[0] if isinstance(ident_name, str) and ident_name.split() else None
    return {
        "name": name,
        "display_name": first_word or name,
        "emoji": ident.get("emoji") if isinstance(ident.get("emoji"), str) else None,
        "theme": ident.get("theme") if isinstance(ident.get("theme"), str) else None,
        "model": model,
        "model_inherited": inherited,
        "can_delegate_to": [a for a in allow if isinstance(a, str)] if isinstance(allow, list) else [],
        "gateway_status": gateway if gateway is not None else openclaw_gateway_status(),
        "last_run_at": last_run,
        # TODO(phase 1 safety): derive from an agent.run.started with no matching agent.run.finished
        # (same run_id, last 2 h) once the pairing is verified against one real live run (plan 2.2).
        "is_running": False,
        "session_count": _session_count(name),
        "error": err,
    }


def openclaw_agents() -> dict:
    cfg, err = _agents_config()
    gw = openclaw_gateway_detail()
    agents = [openclaw_agent_info(n, gw["status"], cfg) for n in list_openclaw_agents()]
    return {"agents": [a for a in agents if a], "gateway": gw["status"], "gateway_detail": gw["detail"],
            "available": err is None, "error": err}

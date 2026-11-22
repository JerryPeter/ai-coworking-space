"""Token/cost usage: aggregated from every profile's <profile>/state.db `sessions` table (read-only),
plus the active OpenCode model from ~/.local/state/opencode/model.json (read-only, allowlisted fields).

Token totals are input_tokens + output_tokens (cache read/write tokens are reported separately and are
NOT part of total_tokens). Cost is Hermes' own `estimated_cost_usd` (actual_cost_usd is summed alongside
for reference; it is usually NULL). Day buckets use the server's local timezone, so "today" matches the
wall clock of the machine the dashboard runs on.

OpenCode keeps no usage log, so only its model/provider is reported; its cost is never invented.
"""
import json
import subprocess
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from api.sources.common import list_profiles, ro_connect
from api.sources.leases import session_leases
from api.sources.state import state_db

OPENCODE_MODEL_FILE = Path.home() / ".local" / "state" / "opencode" / "model.json"

_SQL = (
    "SELECT model, started_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, "
    "estimated_cost_usd, actual_cost_usd FROM sessions"
)


def _bucket() -> dict:
    return {"sessions": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0, "actual_cost_usd": 0.0}


def _add(b: dict, r: dict) -> None:
    i, o = int(r["input_tokens"] or 0), int(r["output_tokens"] or 0)
    b["sessions"] += 1
    b["input_tokens"] += i
    b["output_tokens"] += o
    b["total_tokens"] += i + o
    b["cache_read_tokens"] += int(r["cache_read_tokens"] or 0)
    b["cache_write_tokens"] += int(r["cache_write_tokens"] or 0)
    b["cost_usd"] += float(r["estimated_cost_usd"] or 0)
    b["actual_cost_usd"] += float(r["actual_cost_usd"] or 0)


def _round(b: dict) -> dict:
    return {**b, "cost_usd": round(b["cost_usd"], 4), "actual_cost_usd": round(b["actual_cost_usd"], 4)}


def _profile_rows(profile: str) -> tuple[list[dict], str | None]:
    try:
        with ro_connect(state_db(profile)) as con:
            return [dict(r) for r in con.execute(_SQL).fetchall()], None
    except FileNotFoundError:
        return [], None  # profile without a state.db yet: simply no usage
    except sqlite3.Error as e:
        return [], f"{type(e).__name__}: {e}"


def opencode_model(path: Path = OPENCODE_MODEL_FILE) -> dict:
    """{'available', 'provider', 'model', 'source', 'error'} from OpenCode's recent-model list."""
    base = {"available": False, "provider": None, "model": None, "source": str(path), "error": None}
    if not path.is_file():
        return {**base, "error": "model.json not found"}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        recent = data.get("recent") if isinstance(data, dict) else None
        first = recent[0] if isinstance(recent, list) and recent and isinstance(recent[0], dict) else None
    except (OSError, ValueError) as e:
        return {**base, "error": f"{type(e).__name__}: {e}"}
    if not first:
        return {**base, "error": "no recent model recorded"}
    provider, model = first.get("providerID"), first.get("modelID")
    return {**base, "available": True,
            "provider": provider if isinstance(provider, str) else None,
            "model": model if isinstance(model, str) else None}


def get_limits() -> dict:
    """Account-level rate limits (NOT token totals): Claude via `hermes usage --json`
    (OAuth usage API), OpenCode has no readable limit data so it is reported unavailable."""
    try:
        r = subprocess.run(
            ["hermes", "usage", "--json"],
            capture_output=True, text=True, timeout=15,
        )
        claude_data = json.loads(r.stdout) if r.returncode == 0 else None
    except Exception:
        claude_data = None

    claude_windows = []
    if claude_data and not claude_data.get("unavailable_reason"):
        for w in claude_data.get("windows", []):
            claude_windows.append({
                "label": w["label"],
                "used_percent": w.get("used_percent"),
                "remaining_percent": round(100 - (w.get("used_percent") or 0), 1),
                "resets_at": w.get("resets_at"),
            })

    return {
        "claude": {
            "provider": claude_data.get("provider") if claude_data else "anthropic",
            "windows": claude_windows,
            "available": bool(claude_windows),
            "unavailable_reason": claude_data.get("unavailable_reason") if claude_data else "Failed to fetch",
        },
        "opencode": {
            "available": False,
            "unavailable_reason": "OpenCode tidak menyimpan data limit yang dapat dibaca",
        },
    }


def get_usage_summary(days: int = 30) -> dict:
    now = datetime.now().astimezone()
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_7 = (today0 - timedelta(days=6)).timestamp()
    start_n = (today0 - timedelta(days=days - 1)).timestamp()
    t_today = today0.timestamp()

    totals = {"all_time": _bucket(), "today": _bucket(), "last_7_days": _bucket(), "window": _bucket()}
    by_model: dict[str, dict] = {}
    by_profile: dict[str, dict] = {}
    daily = {(today0 - timedelta(days=k)).date().isoformat(): _bucket() for k in range(days - 1, -1, -1)}
    profiles_meta, active_total = [], 0

    for p in list_profiles():
        rows, err = _profile_rows(p)
        leases = session_leases(p)
        live = leases.get("live_count") or 0
        active_total += live
        profiles_meta.append({"profile": p, "available": err is None, "error": err,
                              "sessions": len(rows), "active_sessions": live})
        for r in rows:
            ts = float(r["started_at"] or 0)
            _add(totals["all_time"], r)
            if ts >= start_7:
                _add(totals["last_7_days"], r)
            if ts >= t_today:
                _add(totals["today"], r)
            if ts < start_n:
                continue
            _add(totals["window"], r)
            _add(by_model.setdefault(r["model"] or "unknown", _bucket()), r)
            _add(by_profile.setdefault(p, _bucket()), r)
            day = datetime.fromtimestamp(ts).astimezone().date().isoformat()
            if day in daily:
                _add(daily[day], r)

    def ranked(d: dict, key: str) -> list[dict]:
        return sorted(({key: k, **_round(v)} for k, v in d.items()),
                      key=lambda x: (x["cost_usd"], x["total_tokens"]), reverse=True)

    return {
        "generated_at": now.isoformat(),
        "timezone": now.tzname(),
        "window_days": days,
        "totals": {k: _round(v) for k, v in totals.items()},
        "by_model": ranked(by_model, "model"),
        "by_profile": ranked(by_profile, "profile"),
        "daily": [{"date": d, **_round(v)} for d, v in daily.items()],
        "active_sessions": active_total,
        "profiles": profiles_meta,
        "opencode": {**opencode_model(), "cost_available": False,
                     "note": "OpenCode tidak menyimpan usage log; biaya tidak dilacak."},
        "source": "~/.hermes/profiles/*/state.db + ~/.hermes/state.db: sessions (tokens, estimated_cost_usd); "
                  "active = live leases in <profile>/runtime/active_sessions.json; "
                  "OpenCode model from ~/.local/state/opencode/model.json",
    }

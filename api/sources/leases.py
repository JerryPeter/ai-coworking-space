"""Per-profile open chat-session leases: <profile>/runtime/active_sessions.json (read-only).

Hermes writes one lease per open interactive session (gateway chat, CLI, ...). A lease counts as
live only if its pid exists and, when the lease records process_start_time (psutil create_time),
/proc's start time for that pid matches, the same check Hermes uses
(hermes_cli/active_sessions.py:_pid_liveness), so a recycled pid is not mistaken for a live lease.

Informational only: no office state rule depends on it (v1 had no rule for leases).
Contributed by the Claude Code CLI takeover run (branch wip/claude-takeover); moved into its own
module unchanged in logic.
"""
import json
import os
from pathlib import Path

from api.sources.common import resolve_profile_home

PROC = Path("/proc")
_START_TOLERANCE_S = 0.02  # /proc starttime has clock-tick (10 ms) resolution


def _boot_time() -> float | None:
    try:
        for line in (PROC / "stat").read_text().splitlines():
            if line.startswith("btime "):
                return float(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return None


def _proc_create_time(pid: int, btime: float | None) -> float | None:
    """Epoch start time of pid, computed the way psutil does (btime + starttime/CLK_TCK).
    Raises FileNotFoundError if the pid does not exist."""
    text = (PROC / str(pid) / "stat").read_text()
    if btime is None:
        return None
    ticks = int(text[text.rindex(")") + 2:].split()[22 - 3])
    return btime + ticks / os.sysconf("SC_CLK_TCK")


def session_leases(profile: str) -> dict:
    """{'available', 'file_present', 'live_count', 'total', 'leases', 'error'}.
    Each lease's `live` is True/False, or None when unknowable."""
    f = resolve_profile_home(profile) / "runtime" / "active_sessions.json"
    base = {"available": True, "file_present": False, "live_count": 0, "total": 0, "leases": [], "error": None}
    if not f.is_file():
        return base
    try:
        data = json.loads(f.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        return {**base, "available": False, "file_present": True, "live_count": None, "total": None,
                "error": f"{type(e).__name__}: {e}"}
    entries = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        return {**base, "available": False, "file_present": True, "live_count": None, "total": None,
                "error": "unrecognised active_sessions.json shape"}
    btime = _boot_time()
    leases = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        live = None
        try:
            pid = int(e.get("pid") or 0)
        except (TypeError, ValueError):
            pid = 0
        if pid > 0 and PROC.is_dir():
            try:
                actual = _proc_create_time(pid, btime)
                expected = e.get("process_start_time")
                if expected in (None, ""):
                    live = True  # Hermes treats a lease without a recorded start time as alive
                elif actual is not None:
                    live = abs(actual - float(expected)) < _START_TOLERANCE_S
            except FileNotFoundError:
                live = False
            except (OSError, ValueError, IndexError, TypeError):
                live = None
        leases.append({"session_id": e.get("session_id"), "surface": e.get("surface"), "pid": pid or None,
                       "started_at": e.get("started_at"), "updated_at": e.get("updated_at"), "live": live})
    return {**base, "file_present": True, "total": len(leases),
            "live_count": sum(1 for x in leases if x["live"] is True), "leases": leases}

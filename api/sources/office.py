"""Composite reader for the 3D office scene (read-only).

Combines, per profile:
  - gateway liveness           (profiles.gateway_status: <profile>/gateway.lock + /proc)
  - claimed kanban tasks       (kanban.claimed_tasks: ~/.hermes/kanban.db, status running|review)
  - most recent session        (state.latest_activity: <profile>/state.db)
  - open chat-session leases   (<profile>/runtime/active_sessions.json — informational only)
plus the Claude Code CLI tool scan (claude_tool.scan_claude_tool).

State rules are a straight port of v1's static/office-logic.js computeAgent(), evaluated in order:
  1. any input unusable for this profile (gateway "unknown", kanban.db unreadable, state.db
     unreadable, unrecognised gateway status)                       -> "unknown"
  2. gateway "stopped"                                              -> "offline"
     (a Running task is noted in the reason, but a dead gateway wins)
  3. a Running task assigned to the profile                         -> "working"
  4. a Review task assigned to the profile                          -> "reviewing"
     (the task sits in the Review column; that is not proof someone is reviewing it now)
  5. otherwise (gateway running, nothing claimed)                   -> "idle"
v1's extra "kanban list truncated -> unknown" branch cannot occur here: claimed_tasks() is a
targeted query that is never truncated.

Session leases are reported but do NOT change the state (v1 had no rule for them). A lease
counts as live only if its pid exists and, when the lease records process_start_time (psutil
create_time), /proc's start time for that pid matches — the same check Hermes uses
(hermes_cli/active_sessions.py:_pid_liveness), so a recycled pid is not mistaken for a live lease.
"""
import json
import os
from pathlib import Path

from api.sources import kanban, state
from api.sources.claude_tool import TOOL_NAME, scan_claude_tool
from api.sources.common import list_profiles, now_utc, resolve_profile_home
from api.sources.profiles import agent_info

STATES = ("working", "reviewing", "idle", "offline", "unknown")
ACTIVE_WINDOW_MIN = 15  # idle agents active within this many minutes get active_ago_min
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
    """{'available', 'file_present', 'live_count', 'total', 'leases', 'error'} from
    <profile>/runtime/active_sessions.json. live is True/False, or None when unknowable."""
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


def _task_ref(t: dict) -> dict:
    return {"id": t["id"], "title": t["title"], "status": t["status"]}


def _compute_agent(name: str, claimed: dict, now_s: float) -> dict:
    info = agent_info(name)
    latest = state.latest_activity(name)
    leases = session_leases(name)
    s = latest["session"]
    out = {
        "name": name,
        "display_name": info["display_name"],
        "role": info["description"],
        "gateway": info["status"],
        "gateway_detail": info["detail"],
        "state": None,
        "reason": None,
        "task": None,
        "recent": None if s is None else {
            "id": s["id"], "title": s["title"], "description": s["last_activity_description"],
            "at": s["last_activity_at"], "at_iso": s["last_activity_at_iso"],
        },
        "active_ago_min": None,
        "session_leases": {"available": leases["available"], "live_count": leases["live_count"],
                           "total": leases["total"], "error": leases["error"]},
    }

    # 1. source problems -> unknown (same order as v1 sourceProblem()).
    problem = None
    if info["status"] == "unknown":
        problem = "gateway status unknown: " + (info["detail"] or "no detail given")
    elif not claimed["available"]:
        problem = "kanban board unavailable: " + (claimed["error"] or "no error given")
    elif not latest["available"]:
        problem = "sessions unreadable for this profile: " + (latest["error"] or "no error given")
    elif info["status"] not in ("running", "stopped"):
        problem = f'unrecognised gateway status "{info["status"]}"'
    if problem:
        out.update(state="unknown", reason=problem)
        return out

    mine = [t for t in claimed["tasks"] if t["assignee"] == name]
    running = [t for t in mine if t["status"] == "running"]
    review = [t for t in mine if t["status"] == "review"]

    def more(lst):
        return f" (+{len(lst) - 1} more)" if len(lst) > 1 else ""

    if info["status"] == "stopped":
        out["state"] = "offline"
        out["reason"] = "gateway stopped: " + (info["detail"] or "no detail given") + (
            f"; note kanban still shows task {running[0]['id']} as Running" if running else "")
    elif running:
        out.update(state="working", task=_task_ref(running[0]),
                   reason=f"kanban task {running[0]['id']} is in Running, assigned to {name}{more(running)}")
    elif review:
        out.update(state="reviewing", task=_task_ref(review[0]),
                   reason=f"kanban task {review[0]['id']} is in Review column, assigned to {name}{more(review)} "
                          "(task is in Review column — not necessarily being reviewed right now)")
    else:
        out["state"] = "idle"
        out["reason"] = (f"gateway running ({info['detail'] or 'no detail'}); no Running/Review task assigned "
                         f"to {name} among {claimed['total']} kanban task(s)")
        at = out["recent"]["at"] if out["recent"] else None
        if isinstance(at, (int, float)):
            mins = int((now_s - at) // 60)
            if 0 <= mins < ACTIVE_WINDOW_MIN:
                out["active_ago_min"] = mins
    return out


def get_office_state() -> dict:
    """Agent state payload for the 3D office: agents (name order) + state counts + Claude CLI tool."""
    now = now_utc()
    claimed = kanban.claimed_tasks()  # one read shared by every agent
    agents = [_compute_agent(p, claimed, now.timestamp()) for p in list_profiles()]
    tool = scan_claude_tool()
    return {
        "agents": agents,
        "counts": {s: sum(1 for a in agents if a["state"] == s) for s in STATES},
        "total": len(agents),
        "claude_tool": {"name": TOOL_NAME, "kind": "tool", **tool},
        "kanban": {"available": claimed["available"], "total": claimed["total"], "error": claimed["error"]},
        "generated_at": now.isoformat(),
    }

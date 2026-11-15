"""Composite per-agent state for the 3D office scene (read-only).

Python port of v1's static/office-logic.js decision rules, computed server-side so the frontend
only renders. Inputs, all read-only:
  - gateway liveness      <profile>/gateway.lock + /proc        (sources/profiles.py)
  - task claims           ~/.hermes/kanban.db: tasks            (sources/kanban.py)
  - last activity         <profile>/state.db: sessions          (sources/state.py)
  - Claude Code CLI       /proc/*/cmdline scan for `claude -p`  (sources/claude_tool.py)

State rules, first match wins (never guessed):
  1. unknown   - gateway status unknown, or kanban unreadable, or this profile's state.db
                 unreadable (state_reason says which)
  2. offline   - gateway.lock is stale (pid dead / pid reused)
  3. working   - a kanban task assigned to this profile is in Running
  4. reviewing - a kanban task assigned to this profile is in Review
                 (= task sits in the Review column; not proof someone is reviewing right now)
  5. idle      - gateway running, nothing claimed

desk_index is the profile's position in list_profiles() (sorted by name; "default" included),
so each agent keeps a fixed seat whatever its state. Profiles beyond DESK_COUNT get None.
"""
from api.sources import claude_tool, kanban, state
from api.sources.common import list_profiles, now_utc
from api.sources.profiles import agent_info

DESK_COUNT = 4
STATES = ("working", "reviewing", "idle", "offline", "unknown")
# Placeholder palette, indexed by desk. Susi's design spec will replace these.
PLACEHOLDER_COLORS = ("#4F8EF7", "#F7A64F", "#5BC17F", "#C46BE0")
FALLBACK_COLOR = "#9AA0A6"


def _agent_state(info: dict, claims: dict, activity: dict) -> tuple[str, str, dict | None]:
    name, gw = info["name"], info["status"]
    if gw == "unknown":
        return "unknown", "gateway status unknown: " + (info["detail"] or "no detail"), None
    if gw not in ("running", "stopped"):
        return "unknown", f"unrecognised gateway status {gw!r}", None
    if not claims["available"]:
        return "unknown", "kanban board unreadable: " + (claims["error"] or "no error given"), None
    if not activity["available"]:
        return "unknown", "state.db unreadable for this profile: " + (activity["error"] or "no error given"), None

    mine = [t for t in claims["tasks"] if t["assignee"] == name]
    running = [t for t in mine if t["status"] == "running"]
    review = [t for t in mine if t["status"] == "review"]

    def more(lst: list) -> str:
        return f" (+{len(lst) - 1} more)" if len(lst) > 1 else ""

    if gw == "stopped":
        note = f"; note kanban still shows task {running[0]['id']} as Running" if running else ""
        return "offline", "gateway stopped: " + (info["detail"] or "no detail") + note, None
    if running:
        t = running[0]
        return "working", f"kanban task {t['id']} is in Running, assigned to {name}{more(running)}", t
    if review:
        t = review[0]
        return ("reviewing", f"kanban task {t['id']} is in Review, assigned to {name}{more(review)} "
                "(in Review column; not necessarily being reviewed right now)", t)
    return ("idle", f"gateway running; no Running/Review task assigned to {name} "
            f"among {claims['total']} kanban task(s)", None)


def office_state() -> dict:
    claims = kanban.claimed_tasks()
    agents = []
    for i, name in enumerate(list_profiles()):
        info = agent_info(name)
        act = state.latest_activity(name)
        st, reason, task = _agent_state(info, claims, act)
        sess = act["session"]
        desk = i if i < DESK_COUNT else None
        agents.append({
            "name": name,
            "display_name": info["display_name"],
            "state": st,
            "state_reason": reason,
            "current_task": task["title"] if task else None,
            "current_task_id": task["id"] if task else None,
            "last_activity": sess["last_activity_description"] if sess else None,
            "last_activity_at": sess["last_activity_at_iso"] if sess else None,
            "gateway": info["status"],
            "desk_index": desk,
            "agent_color": PLACEHOLDER_COLORS[desk] if desk is not None else FALLBACK_COLOR,
        })
    tool = claude_tool.scan_claude_tool()
    return {
        "agents": agents,
        "counts": {s: sum(1 for a in agents if a["state"] == s) for s in STATES},
        "desk_count": DESK_COUNT,
        "claude_tool": {
            "name": claude_tool.TOOL_NAME,
            "state": tool["state"],
            "process_count": tool["process_count"],
            "detail": tool["detail"],
        },
        "generated_at": now_utc().isoformat(),
    }

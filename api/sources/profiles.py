"""Agent (profile) metadata + honest gateway liveness check (read-only).

Status rules (never guessed):
- "running": <profile>/gateway.lock exists, parses, names this profile's hermes_home, its pid
  is alive, AND /proc/<pid>/stat starttime (field 22) equals the lock's start_time — so a
  recycled pid can't be mistaken for the gateway.
- "stopped": the lock exists and parses, but that pid is gone or its starttime differs
  (stale lock left by a gateway that is no longer running).
- "unknown": no lock file, unparseable lock, lock for another home, or /proc unavailable.
  (Without a lock we cannot tell whether the agent is in use via one-shot CLI runs.)
"""
import json
from pathlib import Path

import yaml

from api.sources.common import profile_home_label, resolve_profile_home

PROC = Path("/proc")


def _proc_starttime(pid: int) -> int | None:
    """Field 22 of /proc/<pid>/stat. Raises FileNotFoundError if the pid is not alive."""
    text = (PROC / str(pid) / "stat").read_text()
    # comm (field 2) may contain spaces/parens; fields after the last ')' start at field 3.
    rest = text[text.rindex(")") + 2:].split()
    return int(rest[22 - 3])


def gateway_status(pdir: Path) -> dict:
    lock = pdir / "gateway.lock"
    out = {"status": "unknown", "detail": None, "gateway_pid": None}
    if not lock.is_file():
        out["detail"] = "no gateway.lock in profile dir; running state cannot be determined"
        return out
    try:
        data = json.loads(lock.read_text(encoding="utf-8"))
        pid, start = int(data["pid"]), int(data["start_time"])
    except (OSError, ValueError, KeyError, TypeError) as e:
        out["detail"] = f"gateway.lock unreadable: {type(e).__name__}"
        return out
    out["gateway_pid"] = pid
    lock_home = data.get("hermes_home")
    if lock_home and Path(lock_home).resolve() != pdir.resolve():
        out["detail"] = f"gateway.lock belongs to a different home ({lock_home})"
        return out
    if not PROC.is_dir():
        out["detail"] = "/proc not available; cannot check pid"
        return out
    try:
        actual = _proc_starttime(pid)
    except FileNotFoundError:
        return {**out, "status": "stopped", "detail": f"gateway.lock pid {pid} is not alive (stale lock)"}
    except (OSError, ValueError, IndexError) as e:
        out["detail"] = f"could not read /proc/{pid}/stat: {type(e).__name__}"
        return out
    if actual != start:
        return {**out, "status": "stopped",
                "detail": f"pid {pid} alive but starttime {actual} != lock start_time {start} (pid reused; stale lock)"}
    return {**out, "status": "running",
            "detail": f"gateway pid {pid} alive; /proc starttime matches gateway.lock ({start})"}


def description(pdir: Path) -> str | None:
    f = pdir / "profile.yaml"
    try:
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return None
    d = data.get("description") if isinstance(data, dict) else None
    return d if isinstance(d, str) else None


def agent_info(name: str) -> dict:
    """v2 shape: v1 fields + display_name (profile.yaml description, falling back to the name)
    + home (where the profile's data lives, "~"-relative label)."""
    pdir = resolve_profile_home(name)
    desc = description(pdir)
    return {"name": name, "display_name": desc or name, "description": desc,
            "home": profile_home_label(name), **gateway_status(pdir)}

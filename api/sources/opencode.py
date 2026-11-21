"""OpenCode engine as an office "tool": live process-presence scan (read-only).

Parses /proc/<pid>/cmdline directly — no psutil, no subprocess, no shell, no OpenCode HTTP calls.
A process counts as OpenCode when its *program* (argv[0], or argv[1] behind a node/bun launcher)
has basename `opencode`, `opencode.exe` or `opencode-pty`. Matching argv elements (not a substring
of the joined cmdline) rejects false positives such as `bash -c '... opencode run ...'` or
`grep opencode`.

States:
  working  >=1 `opencode run ...` or `opencode agent ...` process (first non-flag argument)
  standby  OpenCode processes exist (`opencode serve`, `opencode-pty`, an idle TUI, ...) but none
           of them is `run`/`agent`
  offline  no OpenCode process at all
  unknown  /proc unreadable
"""
import os
from pathlib import Path

TOOL_NAME = "OpenCode"
_PROGRAMS = {"opencode", "opencode-pty"}
_RUNTIMES = {"node", "bun", "nodejs"}
_WORK_CMDS = {"run", "agent"}


def _prog(path: str) -> str:
    base = os.path.basename(path)
    return base[:-4] if base.lower().endswith(".exe") else base


def _classify(argv: list[str]) -> str | None:
    """None (not OpenCode), "working" (run/agent) or "standby" (any other OpenCode process)."""
    if not argv:
        return None
    prog = _prog(argv[0])
    if prog in _PROGRAMS:
        args = argv[1:]
    elif prog in _RUNTIMES and len(argv) > 1 and _prog(argv[1]) in _PROGRAMS:
        prog, args = _prog(argv[1]), argv[2:]
    else:
        return None
    if prog == "opencode":
        sub = next((a for a in args if not a.startswith("-")), None)
        if sub in _WORK_CMDS:
            return "working"
    return "standby"


def scan_opencode(proc_root: Path = Path("/proc")) -> dict:
    """Return {"state", "process_count", "pids", "detail"} for live OpenCode processes.

    Processes that vanish or deny access mid-scan are skipped (normal /proc races).
    """
    try:
        entries = [e for e in os.listdir(proc_root) if e.isdigit()]
    except OSError as exc:
        return {"state": "unknown", "process_count": 0, "pids": [],
                "detail": f"{proc_root} unreadable: {exc.__class__.__name__}: {exc}"}
    working: list[int] = []
    standby: list[int] = []
    for pid in entries:
        try:
            raw = (Path(proc_root) / pid / "cmdline").read_bytes()
        except OSError:
            continue
        argv = [a.decode("utf-8", "replace") for a in raw.split(b"\0") if a]
        kind = _classify(argv)
        if kind == "working":
            working.append(int(pid))
        elif kind == "standby":
            standby.append(int(pid))
    pids = sorted(working + standby)
    n = len(pids)
    if working:
        state = "working"
        detail = (f"{len(working)} `opencode run|agent` process{'es' if len(working) != 1 else ''} "
                  f"(pid {', '.join(map(str, sorted(working)))}); {n} OpenCode process{'es' if n != 1 else ''} total")
    elif standby:
        state = "standby"
        detail = (f"{n} OpenCode process{'es' if n != 1 else ''} (serve/pty/tui, pid "
                  f"{', '.join(map(str, pids))}); no `opencode run|agent`")
    else:
        state = "offline"
        detail = f"no OpenCode process found among {len(entries)} processes in {proc_root}"
    return {"state": state, "process_count": n, "pids": pids, "detail": detail}

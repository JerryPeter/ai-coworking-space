"""Claude Code CLI as an office "tool": live process-presence scan (read-only).

Parses /proc/<pid>/cmdline directly — no psutil dependency, no subprocess, no shell. A process
counts as a Claude Code CLI invocation when:
  - its program is `claude`: argv[0] basename == "claude", or argv[0] is a node/bun runtime and
    argv[1] basename is "claude" (npm-style launcher); AND
  - one of its *own* argv entries is exactly "-p" or "--print".
Matching on argv elements (not a substring of the joined cmdline) is what rejects false positives
such as `bash -c '... claude -p ...'` (argv[0] is bash) or `vim ~/claude-notes -p`.

Multiple concurrent invocations collapse into one pseudo-entity with a process_count. There is no
per-invocation task/dispatch log, so this module never reports a task or recent activity.
"""
import os
from pathlib import Path

TOOL_NAME = "Claude Code CLI"
_PRINT_FLAGS = {"-p", "--print"}
_RUNTIMES = {"node", "bun", "nodejs"}


def _is_claude_print(argv: list[str]) -> bool:
    if not argv:
        return False
    prog = os.path.basename(argv[0])
    if prog == "claude":
        args = argv[1:]
    elif prog in _RUNTIMES and len(argv) > 1 and os.path.basename(argv[1]) == "claude":
        args = argv[2:]
    else:
        return False
    return any(a in _PRINT_FLAGS for a in args)


def scan_claude_tool(proc_root: Path = Path("/proc")) -> dict:
    """Return {"state", "process_count", "pids", "detail"} for live `claude -p` processes.

    state: "working" (>=1 match), "idle" (0 matches), "unknown" (proc_root unreadable).
    Individual processes that vanish or deny access mid-scan are skipped (normal /proc races).
    """
    try:
        entries = [e for e in os.listdir(proc_root) if e.isdigit()]
    except OSError as exc:
        return {"state": "unknown", "process_count": 0, "pids": [],
                "detail": f"{proc_root} unreadable: {exc.__class__.__name__}: {exc}"}
    pids = []
    for pid in entries:
        try:
            raw = (Path(proc_root) / pid / "cmdline").read_bytes()
        except OSError:
            continue  # exited or not ours to read
        argv = [a.decode("utf-8", "replace") for a in raw.split(b"\0") if a]
        if _is_claude_print(argv):
            pids.append(int(pid))
    pids.sort()
    n = len(pids)
    if n:
        detail = f"{n} live `claude -p` process{'es' if n != 1 else ''} (pid {', '.join(map(str, pids))})"
        return {"state": "working", "process_count": n, "pids": pids, "detail": detail}
    return {"state": "idle", "process_count": 0, "pids": [],
            "detail": f"no `claude -p` process found among {len(entries)} processes in {proc_root}"}

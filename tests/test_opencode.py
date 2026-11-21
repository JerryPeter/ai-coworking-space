"""Tests for the read-only OpenCode process scanner and tools endpoint."""
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.routers import agents  # noqa: E402
from api.sources.opencode import _classify, scan_opencode  # noqa: E402

failed = 0
checks = 0


def check(label, got, want):
    global failed, checks
    checks += 1
    ok = got == want
    failed += not ok
    print(("PASS" if ok else "FAIL"), label, "" if ok else f"(got {got!r}, want {want!r})")


check("opencode run is working", _classify(["/usr/bin/opencode", "run", "task"]), "working")
check("node launcher agent is working", _classify(["node", "/usr/bin/opencode", "agent", "task"]), "working")
check("serve is standby", _classify(["opencode", "serve"]), "standby")
check("pty is standby", _classify(["/usr/bin/opencode-pty"]), "standby")
check("shell mentioning opencode is ignored", _classify(["bash", "-c", "opencode run task"]), None)
check("empty argv is ignored", _classify([]), None)

with tempfile.TemporaryDirectory() as d:
    root = Path(d)
    processes = {
        "10": ["/usr/bin/opencode", "run", "task"],
        "2": ["node", "/usr/bin/opencode", "serve"],
        "3": ["bash", "-c", "opencode run task"],
    }
    for pid, argv in processes.items():
        proc = root / pid
        proc.mkdir()
        (proc / "cmdline").write_bytes(b"\0".join(arg.encode() for arg in argv) + b"\0")
    result = scan_opencode(root)
    check("scan sees working process", result["state"], "working")
    check("scan counts only OpenCode processes", result["process_count"], 2)
    check("scan returns sorted process ids", result["pids"], [2, 10])

with tempfile.TemporaryDirectory() as d:
    check("empty proc root is offline", scan_opencode(Path(d))["state"], "offline")
check("unreadable proc root is unknown", scan_opencode(Path("/missing-proc-root"))["state"], "unknown")

with patch.object(agents, "scan_claude_tool", return_value={
    "state": "idle", "process_count": 0, "pids": [], "detail": "claude idle",
}), patch.object(agents, "scan_opencode", return_value={
    "state": "working", "process_count": 1, "pids": [42], "detail": "opencode active",
}):
    response = agents.list_tools()
    check("tools endpoint includes Claude and OpenCode", [t["name"] for t in response["tools"]],
          ["Claude Code CLI", "OpenCode"])
    check("tools endpoint exposes OpenCode state", response["tools"][1]["state"], "working")
    check("tools endpoint preserves OpenCode process details", response["tools"][1]["pids"], [42])
    check("tools endpoint describes process scan", "OpenCode" in response["source"], True)

live_response = agents.list_tools()
check("live tools endpoint includes OpenCode", any(t["name"] == "OpenCode" for t in live_response["tools"]), True)
open_code = next(t for t in live_response["tools"] if t["name"] == "OpenCode")
check("live OpenCode state uses supported vocabulary", open_code["state"] in {"working", "standby", "offline", "unknown"}, True)

print(f"{checks - failed}/{checks} passed")
sys.exit(1 if failed else 0)

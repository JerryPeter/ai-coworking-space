from fastapi import APIRouter

from api.sources.claude_tool import TOOL_NAME, scan_claude_tool
from api.sources.common import list_profiles
from api.sources.opencode import TOOL_NAME as OPENCODE_TOOL_NAME, scan_opencode
from api.sources.profiles import agent_info

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("")
def list_agents() -> dict:
    agents = [agent_info(p) for p in list_profiles()]
    return {
        "agents": agents,
        "count": len(agents),
        "source": "~/.hermes/profiles/* and ~/.hermes (default profile) "
                  "(status from <profile>/gateway.lock + /proc; description from profile.yaml)",
    }


@router.get("/tools")
def list_tools() -> dict:
    """Non-profile office entities detected from live process state."""
    claude = scan_claude_tool()
    opencode = scan_opencode()
    return {
        "tools": [{
            "name": TOOL_NAME,
            "kind": "tool",
            "state": claude["state"],
            "process_count": claude["process_count"],
            "pids": claude["pids"],
            "detail": claude["detail"],
        }, {
            "name": OPENCODE_TOOL_NAME,
            "kind": "tool",
            "state": opencode["state"],
            "process_count": opencode["process_count"],
            "pids": opencode["pids"],
            "detail": opencode["detail"],
        }],
        "source": "read-only process scan of /proc/*/cmdline (Claude Code CLI and OpenCode)",
    }

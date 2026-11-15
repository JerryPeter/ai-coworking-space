from fastapi import APIRouter

from api.sources.claude_tool import TOOL_NAME, scan_claude_tool
from api.sources.common import list_profiles
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
    """Non-profile office entities. Currently only Claude Code CLI (live `claude -p` processes)."""
    scan = scan_claude_tool()
    return {
        "tools": [{
            "name": TOOL_NAME,
            "kind": "tool",
            "state": scan["state"],
            "process_count": scan["process_count"],
            "pids": scan["pids"],
            "detail": scan["detail"],
        }],
        "source": "process scan of /proc/*/cmdline (argv match: claude ... -p|--print)",
    }

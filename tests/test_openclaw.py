"""Tests for api/sources/openclaw.py pure helpers + system-agent filtering (no ~/.openclaw touched).

Run: .venv/bin/python tests/test_openclaw.py   (needs .env present, as config fails fast)
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import config  # noqa: E402
from api.sources import openclaw as oc  # noqa: E402

failed = 0


def check(label, got, want):
    global failed
    ok = got == want
    failed += not ok
    print(("PASS" if ok else "FAIL"), label, "" if ok else f"(got {got!r}, want {want!r})")


check("model: strip provider + @profile",
      oc._model_label({"model": {"primary": "openrouter/~openai/gpt-x@openrouter:setup-1"}}, None), ("~openai/gpt-x", False))
check("model: inherited default", oc._model_label({}, "anthropic/claude-opus-5-5"), ("claude-opus-5-5", True))
check("model: none", oc._model_label({}, None), (None, True))
check("ms -> iso", oc._ms_to_iso(0), "1970-01-01T00:00:00+00:00")

with tempfile.TemporaryDirectory() as d:
    (Path(d) / "openclaw.json").write_text(json.dumps({
        "gateway": {"auth": {"token": "SECRET-SHOULD-NOT-APPEAR"}},
        "agents": {"defaults": {"model": "anthropic/claude-opus-5-5"},
                   "entries": {"chief": {"identity": {"name": "Chief", "emoji": "C"}}, "openclaw": {}}}}))
    config.OPENCLAW_HOME = Path(d)
    check("system agent filtered", oc.list_openclaw_agents(), ["chief"])
    check("system agent -> None", oc.openclaw_agent_info("openclaw"), None)
    r = oc.openclaw_agents()
    check("no db -> gateway unknown", r["gateway"], "unknown")
    check("missing agent db -> 0 sessions", r["agents"][0]["session_count"], 0)
    check("is_running off (phase 1)", r["agents"][0]["is_running"], False)
    check("no secret in payload", "SECRET" in json.dumps(r), False)

sys.exit(1 if failed else 0)

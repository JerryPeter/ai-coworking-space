"""Smoke/shape tests for api/sources/usage.py (reads live state.db files read-only).

Run: .venv/bin/python tests/test_usage.py   (needs .env present, as config fails fast)
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.sources.usage import get_usage_summary, opencode_model  # noqa: E402


def main() -> int:
    d = get_usage_summary(30)
    t = d["totals"]
    assert len(d["daily"]) == 30, len(d["daily"])
    w = t["window"]
    # by_model / by_profile / daily must each add up to the window totals
    for part in ("by_model", "by_profile", "daily"):
        assert sum(x["sessions"] for x in d[part]) == w["sessions"], part
        assert sum(x["total_tokens"] for x in d[part]) == w["total_tokens"], part
        assert abs(sum(x["cost_usd"] for x in d[part]) - w["cost_usd"]) < 0.01, part
    assert t["today"]["sessions"] <= t["last_7_days"]["sessions"] <= w["sessions"] <= t["all_time"]["sessions"]

    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "model.json"
        assert opencode_model(f)["available"] is False
        f.write_text(json.dumps({"recent": [{"providerID": "p", "modelID": "m"}]}))
        assert opencode_model(f) == {"available": True, "provider": "p", "model": "m", "source": str(f), "error": None}
        f.write_text("not json")
        assert opencode_model(f)["available"] is False

    print(json.dumps({"totals": t, "by_model": d["by_model"], "by_profile": d["by_profile"],
                      "active_sessions": d["active_sessions"], "opencode": d["opencode"],
                      "timezone": d["timezone"], "daily_tail": d["daily"][-3:]}, indent=1))
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Rule tests for api/sources/office.py::_agent_state (pure function; no Hermes data touched).

Run: .venv/bin/python tests/test_office_rules.py   (needs .env present, as config fails fast)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.sources.office import _agent_state  # noqa: E402

OK_ACT = {"available": True, "session": None, "error": None}


def info(status, name="a", detail="d"):
    return {"name": name, "status": status, "detail": detail}


def claims(*tasks, available=True):
    return {"available": available, "tasks": list(tasks) if available else None,
            "total": len(tasks) if available else None, "error": None if available else "boom"}


def task(i, status, assignee="a"):
    return {"id": i, "title": f"T{i}", "assignee": assignee, "status": status}


CASES = [
    ("gateway unknown -> unknown", info("unknown"), claims(task(1, "running")), OK_ACT, "unknown", None),
    ("odd gateway -> unknown", info("weird"), claims(), OK_ACT, "unknown", None),
    ("kanban unreadable -> unknown", info("running"), claims(available=False), OK_ACT, "unknown", None),
    ("state.db unreadable -> unknown", info("running"), claims(),
     {"available": False, "session": None, "error": "x"}, "unknown", None),
    ("stopped beats running task -> offline", info("stopped"), claims(task(1, "running")), OK_ACT, "offline", None),
    ("running task -> working", info("running"), claims(task(1, "review"), task(2, "running")), OK_ACT, "working", "T2"),
    ("review task -> reviewing", info("running"), claims(task(3, "review")), OK_ACT, "reviewing", "T3"),
    ("other assignee ignored -> idle", info("running"), claims(task(4, "running", "b")), OK_ACT, "idle", None),
    ("nothing claimed -> idle", info("running"), claims(), OK_ACT, "idle", None),
]

failed = 0
for label, i, c, a, want_state, want_title in CASES:
    st, reason, t = _agent_state(i, c, a)
    title = t["title"] if t else None
    ok = st == want_state and title == want_title and isinstance(reason, str) and reason
    failed += not ok
    print(("PASS" if ok else "FAIL"), label, "" if ok else f"(got {st!r}, {title!r}, {reason!r})")
print(f"{len(CASES) - failed}/{len(CASES)} passed")
sys.exit(1 if failed else 0)

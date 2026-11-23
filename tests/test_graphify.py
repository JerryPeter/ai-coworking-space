"""Tests for api/sources/graphify.py + api/routers/graphify.py wiring.

graphify-out/ fixtures are synthetic (small, schema-accurate subset of the real graph.json/
GRAPH_REPORT.md format) so these tests never touch the real repo's graphify-out/ and never run
the graphify CLI for real — subprocess.Popen is mocked throughout.

Run: .venv/bin/python tests/test_graphify.py   (needs .env present, as config fails fast)
"""
import json
import re
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

failed = 0
checks = 0


def check(label, got, want):
    global failed, checks
    checks += 1
    ok = got == want
    failed += not ok
    print(("PASS" if ok else "FAIL"), label, "" if ok else f"(got {got!r}, want {want!r})")


# ---------- fixture graph.json / GRAPH_REPORT.md (schema-accurate subset of the real files) ----------
FIXTURE_GRAPH = {
    "directed": False, "multigraph": False,
    "graph": {"schema_version": 1, "graphify_version": "0.9.118"},
    "nodes": [
        {"id": "n_createtownhall", "label": "createTownHall()", "_callable": True,
         "community": 0, "community_name": "Town Hall Building Geometry",
         "file_type": "code", "source_file": "src/office/townhall.ts"},
        {"id": "n_officescene3d", "label": "OfficeScene3D", "_callable": True, "_callable_class": True,
         "community": 10, "community_name": "Office Scene Core",
         "file_type": "code", "source_file": "src/office/OfficeScene3D.ts"},
        {"id": "n_module_file", "label": "main.py", "kind": "file",
         "community": 1, "community_name": "FastAPI App Setup",
         "file_type": "code", "source_file": "api/main.py"},
        {"id": "n_external", "label": "three", "type": "external",
         "community": 10, "community_name": "Office Scene Core", "file_type": "code"},
        {"id": "n_concept", "label": "Some Idea", "community": 2, "community_name": "Concepts",
         "file_type": "concept"},
        {"id": "n_router", "label": "get_stats()", "_callable": True,
         "community": 1, "community_name": "FastAPI App Setup",
         "file_type": "code", "source_file": "api/routers/graphify.py"},
    ],
    "links": [
        {"source": "n_createtownhall", "target": "n_officescene3d", "relation": "calls"},
        {"source": "n_createtownhall", "target": "n_module_file", "relation": "calls"},  # cross api<->src
        {"source": "n_createtownhall", "target": "n_external", "relation": "references"},
        {"source": "n_officescene3d", "target": "n_external", "relation": "references"},
        {"source": "n_router", "target": "n_module_file", "relation": "calls"},  # backend <-> backend
    ],
    "hyperedges": [],
    "built_at_commit": "deadbeef00000000000000000000000000000000",
}
FIXTURE_REPORT = """# Graph Report - fixture

## Summary
- 6 nodes \u00b7 5 edges \u00b7 4 communities

## Import Cycles
- None detected.
"""


def make_fixture(tmp: Path) -> Path:
    out = tmp / "graphify-out"
    out.mkdir()
    (out / "graph.json").write_text(json.dumps(FIXTURE_GRAPH))
    (out / "GRAPH_REPORT.md").write_text(FIXTURE_REPORT)
    return out


with tempfile.TemporaryDirectory() as d:
    out_dir = make_fixture(Path(d))
    with patch("api.sources.graphify.GRAPHIFY_OUT", out_dir), \
         patch("api.sources.graphify.GRAPH_JSON", out_dir / "graph.json"), \
         patch("api.sources.graphify.GRAPH_REPORT", out_dir / "GRAPH_REPORT.md"), \
         patch("api.sources.graphify.GRAPH_HTML", out_dir / "graph.html"), \
         patch("api.sources.graphify._current_commit", return_value="deadbeef00000000000000000000000000000000"):
        from api.sources import graphify as src  # noqa: E402

        src._cache["mtime"] = None
        src._cache["parsed"] = None

        # ---- stats ----
        stats = src.graph_stats()
        check("stats: total_nodes", stats["total_nodes"], 6)
        check("stats: total_edges", stats["total_edges"], 5)
        check("stats: communities (unique community ids across nodes)", stats["communities"], 4)
        check("stats: import_cycles (None detected -> 0)", stats["import_cycles"], 0)
        check("stats: not stale when built_at == current commit", stats["stale"], False)
        check("stats: graphify_version read from graph.json", stats["graphify_version"], "0.9.118")

        # ---- top-nodes: degree + type derivation ----
        top = src.top_nodes(10)
        by_label = {n["label"]: n for n in top}
        check("top-nodes: createTownHall() degree (links touching the node)", by_label["createTownHall()"]["degree"], 3)
        check("top-nodes: OfficeScene3D degree", by_label["OfficeScene3D"]["degree"], 2)
        check("top-nodes: createTownHall() type -> function", by_label["createTownHall()"]["type"], "function")
        check("top-nodes: OfficeScene3D type -> class (_callable_class)", by_label["OfficeScene3D"]["type"], "class")
        check("top-nodes: file-kind node -> module", by_label["main.py"]["type"], "module")
        check("top-nodes: type==external node -> external", by_label["three"]["type"], "external")
        check("top-nodes: file_type concept -> concept", by_label["Some Idea"]["type"], "concept")
        check("top-nodes: limit respected", len(src.top_nodes(2)), 2)

        # ---- findings ----
        f1, f2, f3 = src.findings()
        check("findings: createTownHall degree is dynamic, not hardcoded", f1["degree"], 3)
        check("findings: createTownHall title embeds degree", "3 koneksi" in f1["title"], True)
        check("findings: createTownHall card is a warning (CTO notes #2)", f1["status"], "warning")
        check("findings: OfficeScene3D degree is dynamic", f2["degree"], 2)
        check("findings: OfficeScene3D card is a warning (CTO notes #2)", f2["status"], "warning")
        check("findings: backend architecture ok (0 cycles, communities separated)", f3["status"], "ok")
        check("findings: backend communities detected", f3["detail"]["backend_communities"], ["FastAPI App Setup"])
        check("findings: cross-boundary api<->src edges counted as-is", f3["detail"]["cross_boundary_edges"], 1)

        # ---- GraphNotFound -> empty-state trigger ----
        (out_dir / "graph.json").unlink()
        src._cache["mtime"] = None
        src._cache["parsed"] = None
        try:
            src.graph_stats()
            check("missing graph.json raises GraphNotFound", "no exception", "GraphNotFound")
        except src.GraphNotFound:
            check("missing graph.json raises GraphNotFound", "GraphNotFound", "GraphNotFound")

# ---------- update job: single-flight + mocked subprocess (graphify CLI is never actually run) ----------
from unittest.mock import MagicMock  # noqa: E402

from api.sources import graphify as src  # noqa: E402  (re-import outside the patched block)

src._jobs.clear()
src._current_job_id = None


class _FakeProc:
    def __init__(self, lines, returncode=0):
        self.stdout = iter(lines)
        self.pid = 4242
        self._returncode = returncode
    def wait(self, timeout=None):  # noqa: ANN001
        return self._returncode
    def kill(self):
        self._returncode = -9


with patch("api.sources.graphify.subprocess.Popen", return_value=_FakeProc(["line one\n", "line two\n"])), \
     patch("api.sources.graphify._graphify_executable", return_value="/fake/bin/graphify"):
    job, started = src.start_update()
    check("start_update: first call starts a job", started, True)
    deadline = time.monotonic() + 5
    while job["status"] not in ("succeeded", "failed") and time.monotonic() < deadline:
        time.sleep(0.02)
    check("update job completes (mocked Popen)", job["status"], "succeeded")
    check("update job returncode", job["returncode"], 0)
    check("update job log tail captured", job["log_tail"], ["line one", "line two"])
    check("job registry no longer holds the completed job as current", src._current_job_id, None)
    check("get_job returns the completed job", src.get_job(job["job_id"])["job_id"], job["job_id"])
    check("get_job: unknown id -> None", src.get_job("00000000-0000-0000-0000-000000000000"), None)

# single-flight: a job "running" blocks a second POST (adopts the same job_id, 409 at router level)
src._jobs.clear()
src._current_job_id = "running-job"
src._jobs["running-job"] = {"job_id": "running-job", "status": "running"}
job2, started2 = src.start_update()
check("start_update: second call while one is running does not start a new job", started2, False)
check("start_update: returns the already-running job's id", job2["job_id"], "running-job")
src._jobs.clear()
src._current_job_id = None

# executable missing -> job fails cleanly (no crash, no real subprocess attempted)
job3 = {"job_id": "x", "status": "queued", "started_at": None, "finished_at": None, "returncode": None, "log_tail": []}
with patch("api.sources.graphify._graphify_executable", side_effect=FileNotFoundError("graphify CLI not found")):
    src._run_job(job3)
check("missing graphify executable -> job fails (not a crash)", job3["status"], "failed")
check("missing graphify executable -> log explains why", "graphify CLI not found" in job3["log_tail"][0], True)

# ---------- router wiring: /update/{job_id} path pattern ----------
from api.routers._common import JobId  # noqa: E402

job_id_pattern = JobId.metadata[0].pattern
check("JobId pattern accepts a real uuid4", bool(re.match(job_id_pattern, "11111111-2222-4333-8444-555555555555")), True)
check("JobId pattern rejects a non-uuid string", bool(re.match(job_id_pattern, "not-a-uuid")), False)

# ---------- live HTTP: auth + path validation actually enforced end-to-end ----------
# FastAPI 0.163's router composition resolves `dependencies=[Depends(require_token)]` lazily at
# request time (not by mutating each APIRoute.dependant ahead of time), so the only reliable way
# to prove auth/validation is wired up is a real HTTP request — never run against the systemd
# service; a throwaway uvicorn server on an ephemeral port, same process, mocked Popen so a POST
# would never shell out even if auth were (incorrectly) bypassed.
import threading  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

import uvicorn  # noqa: E402

from api import config as _config  # noqa: E402
from api.main import app  # noqa: E402

server_config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
server = uvicorn.Server(server_config)
thread = threading.Thread(target=server.run, daemon=True)
thread.start()
deadline = time.monotonic() + 10
while not server.started and time.monotonic() < deadline:
    time.sleep(0.02)

try:
    port = server.servers[0].sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    token = _config.MISSION_CONTROL_V2_API_TOKEN  # never logged/printed

    def request(method, path, auth=True):
        req = urllib.request.Request(base + path, method=method)
        if auth:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status
        except urllib.error.HTTPError as e:
            return e.code

    # Mock Popen for the lifetime of this block too: if auth were ever bypassed, POST /update
    # must still never shell out to the real graphify CLI.
    with patch("api.sources.graphify.subprocess.Popen", side_effect=AssertionError("must not run graphify in tests")):
        check("POST /api/graphify/update with no token -> 401", request("POST", "/api/graphify/update", auth=False), 401)
        check("GET /api/graphify/stats with no token -> 401", request("GET", "/api/graphify/stats", auth=False), 401)
        check("GET /api/graphify/update/not-a-uuid with token -> 422 (bad format)",
              request("GET", "/api/graphify/update/not-a-uuid"), 422)
        check("GET /api/graphify/update/<unknown-but-valid-uuid> with token -> 404",
              request("GET", "/api/graphify/update/11111111-2222-4333-8444-555555555555"), 404)
finally:
    server.should_exit = True
    thread.join(timeout=10)

print(f"{checks - failed}/{checks} passed")
sys.exit(1 if failed else 0)

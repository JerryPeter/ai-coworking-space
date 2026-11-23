"""Read-only access to graphify-out/ (knowledge-graph artifacts) + a single-flight update job.

graph.json (networkx node-link format, ~1 MB) is parsed once and cached in memory keyed by the
file's mtime, so repeated polling doesn't re-parse it (CTO decision #4 in the Graphify brief).
All reads here are read-only; the only thing that writes anything is `start_update()`, which
shells out to the `graphify` CLI as an argv list (never shell=True) and never touches graph.json
itself — the CLI does that. Job state lives in an in-memory dict; it is lost on process restart,
which is acceptable for a single local dev server.
"""
import json
import re
import os
import shutil
import signal
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api import config

GRAPHIFY_OUT = config.PROJECT_ROOT / "graphify-out"
GRAPH_JSON = GRAPHIFY_OUT / "graph.json"
GRAPH_REPORT = GRAPHIFY_OUT / "GRAPH_REPORT.md"
GRAPH_HTML = GRAPHIFY_OUT / "graph.html"

UPDATE_TIMEOUT_S = 600  # 10 minutes (CTO decision #3); subprocess is killed and the job fails
LOG_TAIL_LINES = 50
_FILE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".md", ".css", ".html")


class GraphNotFound(Exception):
    """graph.json/GRAPH_REPORT.md hasn't been generated yet. Router turns this into a 404 so the
    frontend can show its empty state + Update Graph button instead of a scary 500."""


# ---------- graph.json: parse + cache (keyed by mtime, CTO decision #4) ----------
_cache_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": None, "parsed": None}


def _load_graph() -> dict:
    """{'raw': <graph.json dict>, 'degree': {node_id: int}, 'nodes_by_id': {node_id: node}}."""
    if not GRAPH_JSON.is_file():
        raise GraphNotFound(f"graph.json not found in {GRAPHIFY_OUT} — run Update Graph first")
    mtime = GRAPH_JSON.stat().st_mtime
    with _cache_lock:
        if _cache["mtime"] == mtime and _cache["parsed"] is not None:
            return _cache["parsed"]
    data = json.loads(GRAPH_JSON.read_text())
    degree: dict[str, int] = {}
    for link in data.get("links", []):
        degree[link["source"]] = degree.get(link["source"], 0) + 1
        degree[link["target"]] = degree.get(link["target"], 0) + 1
    nodes_by_id = {n["id"]: n for n in data.get("nodes", [])}
    parsed = {"raw": data, "degree": degree, "nodes_by_id": nodes_by_id}
    with _cache_lock:
        _cache["mtime"] = mtime
        _cache["parsed"] = parsed
    return parsed


def _node_type(node: dict) -> str:
    """class|function|module|external|concept|rationale|other (brief 'Fakta kode' derivation)."""
    if node.get("_callable_class"):
        return "class"
    if node.get("_callable"):
        return "function"
    label = node.get("label") or ""
    if node.get("kind") == "file" or label.endswith(_FILE_EXTENSIONS):
        return "module"
    if node.get("type") == "external":
        return "external"
    file_type = node.get("file_type")
    if file_type in ("concept", "rationale"):
        return file_type
    return "other"


def _parse_cycles(report_text: str) -> tuple[int, list[str]]:
    """0 if '## Import Cycles' says 'None detected.', else the bullet lines listed there."""
    m = re.search(r"## Import Cycles\n(.*?)(\n## |\Z)", report_text, re.S)
    if not m:
        return 0, []
    body = m.group(1).strip()
    if not body or body.lower().startswith("- none detected"):
        return 0, []
    bullets = [ln[2:].strip() for ln in body.splitlines() if ln.strip().startswith("- ")]
    return len(bullets), bullets


def _read_report_text() -> str:
    return GRAPH_REPORT.read_text() if GRAPH_REPORT.is_file() else ""


def _current_commit() -> str | None:
    """Reads .git/HEAD (and the ref it points to) directly — never shells out to git (CTO note)."""
    git_dir = config.PROJECT_ROOT / ".git"
    try:
        head = (git_dir / "HEAD").read_text().strip()
    except OSError:
        return None
    if head.startswith("ref:"):
        ref = head.split(" ", 1)[1].strip()
        try:
            return (git_dir / ref).read_text().strip() or None
        except OSError:
            return None
    return head or None


def _is_stale(built_at: str | None, current: str | None) -> bool:
    if not built_at or not current:
        return False
    a, b = built_at.strip(), current.strip()
    return not (a == b or a.startswith(b) or b.startswith(a))


def graph_stats() -> dict:
    g = _load_graph()
    raw = g["raw"]
    nodes = raw.get("nodes", [])
    links = raw.get("links", [])
    communities = {n["community"] for n in nodes if n.get("community") is not None}
    cycles, cycle_lines = _parse_cycles(_read_report_text())
    built_at = raw.get("built_at_commit")
    current = _current_commit()
    mtime = GRAPH_JSON.stat().st_mtime
    return {
        "total_nodes": len(nodes),
        "total_edges": len(links),
        "communities": len(communities),
        "import_cycles": cycles,
        "import_cycle_details": cycle_lines,
        "graphify_version": (raw.get("graph") or {}).get("graphify_version"),
        "built_at_commit": built_at,
        "current_commit": current,
        "stale": _is_stale(built_at, current),
        "last_updated": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
    }


def top_nodes(limit: int) -> list[dict]:
    g = _load_graph()
    degree, nodes_by_id = g["degree"], g["nodes_by_id"]
    ranked = sorted(nodes_by_id.items(), key=lambda kv: (-degree.get(kv[0], 0), kv[1].get("label") or ""))
    return [
        {
            "id": node_id,
            "label": node.get("label") or node_id,
            "degree": degree.get(node_id, 0),
            "community": node.get("community"),
            "community_name": node.get("community_name"),
            "type": _node_type(node),
        }
        for node_id, node in ranked[:limit]
    ]


def _find_node_by_label(nodes_by_id: dict, label: str) -> dict | None:
    for node in nodes_by_id.values():
        if node.get("label") == label:
            return node
    return None


def _neighbors_by_relation(links: list[dict], node_id: str, top: int = 5) -> list[dict]:
    counts: dict[str, int] = {}
    for link in links:
        if link.get("source") == node_id or link.get("target") == node_id:
            rel = link.get("relation") or "unknown"
            counts[rel] = counts.get(rel, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:top]
    return [{"relation": rel, "count": n} for rel, n in ranked]


def _hub_finding(finding_id: str, title_tpl: str, label: str, recommendation: str, g: dict) -> dict:
    """createTownHall()/OfficeScene3D cards: degree read dynamically, never hardcoded (CTO notes #2)."""
    nodes_by_id, degree = g["nodes_by_id"], g["degree"]
    node = _find_node_by_label(nodes_by_id, label)
    if node is None:
        return {
            "id": finding_id, "title": f"{label} — not found in graph.json", "status": "warning",
            "degree": None, "detail": {"recommendation": "Node not found; run Update Graph and retry."},
        }
    d = degree.get(node["id"], 0)
    return {
        "id": finding_id,
        "title": title_tpl.format(degree=d),
        "status": "warning",  # CTO notes #2: always warning for the two hub cards, not netral Info
        "degree": d,
        "detail": {
            "source_file": node.get("source_file"),
            "community_name": node.get("community_name"),
            "neighbors_by_relation": _neighbors_by_relation(g["raw"].get("links", []), node["id"]),
            "recommendation": recommendation,
        },
    }


def _is_backend_file(path: str) -> bool:
    return path.startswith("api/") or path.startswith("tests/")


def _is_frontend_file(path: str) -> bool:
    return path.startswith("src/")


def _backend_architecture_finding(g: dict) -> dict:
    """Card 3 (CTO notes #2): backend communities (api/ or tests/) + edges crossing api/tests <-> src/."""
    nodes, links, nodes_by_id = g["raw"].get("nodes", []), g["raw"].get("links", []), g["nodes_by_id"]

    def source_file(n: dict) -> str:
        return n.get("source_file") or ""

    backend_communities = sorted({
        n.get("community_name") for n in nodes
        if _is_backend_file(source_file(n)) and n.get("community_name")
    })
    office_communities = {
        n.get("community_name") for n in nodes
        if source_file(n).startswith("src/office/") and n.get("community_name")
    }
    separated = not (set(backend_communities) & office_communities)

    cross = 0
    for link in links:
        s, t = nodes_by_id.get(link.get("source")), nodes_by_id.get(link.get("target"))
        if not s or not t:
            continue
        sp, tp = source_file(s), source_file(t)
        if (_is_backend_file(sp) and _is_frontend_file(tp)) or (_is_backend_file(tp) and _is_frontend_file(sp)):
            cross += 1

    cycles, _lines = _parse_cycles(_read_report_text())
    ok = cycles == 0 and separated
    return {
        "id": "backend-architecture",
        "title": "Arsitektur backend terpisah rapi" if ok else "Arsitektur backend bercampur dengan 3D scene",
        "status": "ok" if ok else "warning",
        "degree": None,
        "detail": {
            "backend_communities": backend_communities,
            "cross_boundary_edges": cross,
            "import_cycles": cycles,
            "recommendation": (
                "Pertahankan batas ini: jangan import modul src/office/* langsung dari api/ atau sebaliknya."
                if ok else
                f"Ada {cross} edge lintas batas api|tests <-> src/ dan/atau {cycles} import cycle — tinjau pemisahan backend/3D."
            ),
        },
    }


def findings() -> list[dict]:
    g = _load_graph()
    return [
        _hub_finding(
            "createtownhall-hub",
            "createTownHall() — {degree} koneksi, kandidat refactor",
            "createTownHall()",
            "Pertimbangkan memecah createTownHall() menjadi fungsi build*() yang lebih kecil untuk mengurangi coupling.",
            g,
        ),
        _hub_finding(
            "officescene3d-hub",
            "OfficeScene3D — {degree} koneksi, titik pusat kritis",
            "OfficeScene3D",
            "Perubahan pada OfficeScene3D berisiko tinggi; tambahkan test sebelum refactor besar.",
            g,
        ),
        _backend_architecture_finding(g),
    ]


# ---------- update job (CTO decision #3: one job at a time, 10-minute timeout) ----------
_job_lock = threading.Lock()
_current_job_id: str | None = None
_jobs: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _graphify_executable() -> str:
    found = shutil.which("graphify")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "graphify"
    if fallback.is_file():
        return str(fallback)
    raise FileNotFoundError("graphify CLI not found on PATH or ~/.local/bin/graphify")


def _finish(job: dict, status: str, returncode: int | None, log_tail: list[str]) -> None:
    global _current_job_id
    job["status"] = status
    job["returncode"] = returncode
    job["log_tail"] = log_tail
    job["finished_at"] = _now_iso()
    with _job_lock:
        if _current_job_id == job["job_id"]:
            _current_job_id = None


def _run_job(job: dict) -> None:
    """Runs in a background thread. Subprocess argv is a fixed list (shell=False); stdout/stderr
    are captured for a short log tail only — no environment variables or tokens are logged."""
    try:
        exe = _graphify_executable()
    except FileNotFoundError as e:
        _finish(job, "failed", None, [str(e)])
        return
    try:
        proc = subprocess.Popen(
            [exe, "update", "."],
            cwd=config.PROJECT_ROOT,
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,  # own process group, so the watchdog can kill children too
        )
    except OSError as e:
        _finish(job, "failed", None, [f"Failed to start graphify: {e}"])
        return

    job["status"] = "running"
    job["pid"] = proc.pid
    lines: list[str] = []
    timed_out = threading.Event()

    def _kill_on_timeout() -> None:
        # Watchdog: fires even if graphify hangs silently (a per-line deadline check would not).
        timed_out.set()
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # children may hold stdout open
        except ProcessLookupError:
            pass

    watchdog = threading.Timer(UPDATE_TIMEOUT_S, _kill_on_timeout)
    watchdog.daemon = True
    watchdog.start()
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            lines.append(line.rstrip("\n"))
            if len(lines) > LOG_TAIL_LINES:
                lines.pop(0)
    finally:
        watchdog.cancel()
    if timed_out.is_set():
        proc.wait(timeout=5)
        lines.append(f"Killed: exceeded {UPDATE_TIMEOUT_S}s timeout")
        _finish(job, "failed", -9, lines)
        return
    returncode = proc.wait()
    _finish(job, "succeeded" if returncode == 0 else "failed", returncode, lines)


def start_update() -> tuple[dict, bool]:
    """Returns (job, started). started=False -> a job is already running; the caller returns 409
    with that job's id so the frontend can adopt it instead of starting a second one."""
    global _current_job_id
    with _job_lock:
        if _current_job_id is not None:
            return _jobs[_current_job_id], False
        job_id = str(uuid.uuid4())
        job = {
            "job_id": job_id, "status": "queued",
            "started_at": _now_iso(), "finished_at": None,
            "returncode": None, "log_tail": [],
        }
        _jobs[job_id] = job
        _current_job_id = job_id
    threading.Thread(target=_run_job, args=(job,), daemon=True, name=f"graphify-update-{job_id[:8]}").start()
    return job, True


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)
